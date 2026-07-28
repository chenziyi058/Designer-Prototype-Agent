from app.generator import smart_ring_spec
from app.schemas import NumberValue, Source
from app.validators import HardwareValidator, bom_totals, validate_protocol


def test_bom_totals_tracks_unknown_cost():
    result = bom_totals([
        {"estimated_unit_price_cny": 10, "quantity": 2},
        {"estimated_unit_price_cny": None, "quantity": 1},
    ], 100)
    assert result["confirmed_cost_cny"] == 20
    assert result["remaining_cny"] == 80
    assert result["pending_item_count"] == 1
    assert not result["is_complete"]


def test_pin_and_voltage_conflicts_are_errors():
    spec = smart_ring_spec()
    spec.hardware.controllers[0].logic_voltage = NumberValue(value=3.3, source=Source.CATALOG)
    spec.hardware.sensors[0].pins = {"A": 4}
    spec.hardware.actuators[0].pins = {"PWM": 4}
    spec.hardware.sensors[0].logic_voltage = NumberValue(value=5, source=Source.CATALOG)
    codes = [x.code for x in HardwareValidator().validate(spec).errors]
    assert "GPIO_CONFLICT" in codes
    assert "LOGIC_OVERVOLTAGE" in codes


def test_motor_requires_driver():
    codes = [x.code for x in HardwareValidator().validate(smart_ring_spec()).errors]
    assert "MOTOR_DRIVER_MISSING" in codes


def test_power_budget_detects_undersized_supply():
    spec = smart_ring_spec()
    for component, current in zip(
        [spec.hardware.actuators[0], spec.hardware.controllers[0], spec.hardware.sensors[0]],
        [1000, 300, 20],
    ):
        component.max_current_ma = NumberValue(value=current, source=Source.CATALOG)
    spec.hardware.power_supply.rated_current_ma = NumberValue(value=500, source=Source.USER)
    codes = [x.code for x in HardwareValidator().validate(spec).errors]
    assert "POWER_SUPPLY_UNDERSIZED" in codes


def test_protocol_consistency():
    schema = {"protocol_version": "1", "baud_rate": 115200, "commands": ["ping"], "error_codes": [], "max_message_bytes": 512}
    assert validate_protocol(schema, dict(schema)).is_valid
    assert not validate_protocol(schema, dict(schema, baud_rate=9600)).is_valid
