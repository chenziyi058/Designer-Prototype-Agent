from __future__ import annotations

from collections import defaultdict

from .schemas import ProjectSpec, ValidationIssue, ValidationReport


class HardwareValidator:
    """Deterministic checks. Unknown values are warnings, never invented facts."""

    def validate(self, spec: ProjectSpec) -> ValidationReport:
        report = ValidationReport()
        components = [
            *spec.hardware.controllers, *spec.hardware.sensors, *spec.hardware.actuators,
            *spec.hardware.motor_drivers,
        ]
        pin_users: dict[int, list[str]] = defaultdict(list)
        for component in components:
            for signal, pin in component.pins.items():
                pin_users[pin].append(f"{component.model.value}:{signal}")
        for pin, users in pin_users.items():
            issue = ValidationIssue(
                level="error", code="GPIO_CONFLICT", title=f"GPIO {pin} 重复占用",
                detail="同一物理引脚被多个信号占用。", affected_items=users,
                recommendation="重新分配引脚并同步固件、接线表与文档。",
            )
            (report.errors if len(users) > 1 else report.passed).append(issue)

        addresses: dict[str, list[str]] = defaultdict(list)
        for component in spec.hardware.sensors:
            if component.i2c_address:
                addresses[component.i2c_address].append(component.model.value)
        for address, users in addresses.items():
            if len(users) > 1:
                report.errors.append(ValidationIssue(
                    level="error", code="I2C_ADDRESS_CONFLICT",
                    title=f"I²C 地址 {address} 冲突", detail="多个器件共享同一地址。",
                    affected_items=users, recommendation="修改地址、增加多路复用器或更换器件。",
                ))

        controller_logic = next(
            (item.logic_voltage.value for item in spec.hardware.controllers if item.logic_voltage.value), None
        )
        for component in [*spec.hardware.sensors, *spec.hardware.actuators]:
            if controller_logic and component.logic_voltage.value and component.logic_voltage.value > controller_logic:
                report.errors.append(ValidationIssue(
                    level="error", code="LOGIC_OVERVOLTAGE", title="逻辑电平不兼容",
                    detail=f"{component.model.value} 的逻辑电压高于主控。",
                    affected_items=[component.model.value],
                    recommendation="核对数据手册并使用合适的电平转换器。",
                ))

        motor_like = [
            item for item in spec.hardware.actuators
            if any(word in item.model.value.lower() for word in ["motor", "电机", "servo", "舵机", "stepper"])
        ]
        if motor_like and not spec.hardware.motor_drivers:
            report.errors.append(ValidationIssue(
                level="error", code="MOTOR_DRIVER_MISSING", title="电机驱动器缺失",
                detail="执行器包含电机类负载，但未定义驱动器。",
                affected_items=[x.model.value for x in motor_like],
                recommendation="根据额定电压、持续电流与启动电流选择驱动器。",
            ))

        known_current = sum(item.max_current_ma.value or 0 for item in components)
        supply_current = spec.hardware.power_supply.rated_current_ma.value
        if supply_current is None or any(item.max_current_ma.value is None for item in components):
            report.warnings.append(ValidationIssue(
                level="warning", code="POWER_BUDGET_INCOMPLETE", title="电源预算不完整",
                detail=f"当前仅能汇总已知负载 {known_current:.0f} mA，存在待确认电流参数。",
                recommendation="查阅正式数据手册并测量启动峰值电流。",
            ))
        elif known_current > supply_current:
            report.errors.append(ValidationIssue(
                level="error", code="POWER_SUPPLY_UNDERSIZED", title="电源额定电流不足",
                detail=f"负载合计 {known_current:.0f} mA，高于电源 {supply_current:.0f} mA。",
                recommendation="选择具有启动余量的独立电源，并共地。",
            ))
        else:
            report.passed.append(ValidationIssue(
                level="passed", code="POWER_BUDGET_BASIC_PASS", title="基础电流预算通过",
                detail=f"负载合计 {known_current:.0f} mA，不高于电源额定值。",
            ))

        if not spec.hardware.power_supply.voltage.value:
            report.warnings.append(ValidationIssue(
                level="warning", code="POWER_VOLTAGE_UNKNOWN", title="供电电压待确认",
                detail="系统电源电压尚未形成可核对的数值。",
                recommendation="首次上电前逐项核对电源、主控、传感器和执行器电压。",
            ))
        report.recommendations.append(ValidationIssue(
            level="recommendation", code="FIRST_POWER_ON",
            title="执行首次上电检查", detail="断开执行器，限流上电并逐路验证。",
            recommendation="保留急停，禁止 GPIO 直接驱动高功率负载。",
        ))
        return report


def bom_totals(items: list[dict], budget_cny: float | None) -> dict:
    confirmed = sum(
        float(item["estimated_unit_price_cny"]) * int(item.get("quantity", 1))
        for item in items if item.get("estimated_unit_price_cny") is not None
    )
    pending_count = sum(item.get("estimated_unit_price_cny") is None for item in items)
    return {
        "budget_cny": budget_cny,
        "confirmed_cost_cny": round(confirmed, 2),
        "pending_item_count": pending_count,
        "remaining_cny": round(budget_cny - confirmed, 2) if budget_cny is not None else None,
        "over_budget": confirmed > budget_cny if budget_cny is not None else False,
        "is_complete": pending_count == 0,
    }


def validate_protocol(firmware: dict, python: dict) -> ValidationReport:
    report = ValidationReport()
    fields = ["protocol_version", "baud_rate", "commands", "error_codes", "max_message_bytes"]
    for field in fields:
        if firmware.get(field) != python.get(field):
            report.errors.append(ValidationIssue(
                level="error", code="PROTOCOL_MISMATCH", title=f"协议字段 {field} 不一致",
                detail="固件与 Python 端必须共享同一协议定义。", affected_items=[field],
                recommendation="从 protocol.schema.json 重新生成两端类型。",
            ))
    if not report.errors:
        report.passed.append(ValidationIssue(
            level="passed", code="PROTOCOL_CONSISTENT", title="协议一致性通过",
            detail="已比较协议版本、波特率、命令、错误码和最大消息长度。",
        ))
    return report
