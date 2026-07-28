def create_project(client):
    response = client.post("/api/projects", json={
        "name": "桌面交互原型",
        "description": "一个通过传感器输入控制低压反馈输出的桌面交互原型",
        "budget_cny": 800,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_create_message_artifacts_and_validation(client):
    project_id = create_project(client)["id"]
    spec = client.get(f"/api/projects/{project_id}/spec")
    assert spec.json()["project"]["name"]["value"] == "桌面交互原型"
    assert client.get(f"/api/projects/{project_id}/spec/versions").json()[0]["version"] == 1
    message = client.post(f"/api/projects/{project_id}/messages", json={"content": "预算降到 500 元以内"})
    assert "BOM" in message.json()["affected_modules"]
    assert message.json()["spec_updated"] is True
    assert message.json()["spec_version"] == 2
    assert client.get(f"/api/projects/{project_id}/spec").json()["constraints"]["budget_cny"]["value"] == 500
    artifacts = client.get(f"/api/projects/{project_id}/artifacts").json()
    assert len(artifacts) >= 20
    file_response = client.get(f"/api/projects/{project_id}/artifacts/{artifacts[0]['id']}")
    assert file_response.status_code == 200
    content_response = client.get(
        f"/api/projects/{project_id}/artifacts/{artifacts[0]['id']}/content"
    )
    assert content_response.status_code == 200
    assert "content" in content_response.json()
    export = client.get(f"/api/projects/{project_id}/export")
    assert export.status_code == 200
    assert export.headers["content-type"] == "application/zip"
    assert "warnings" in client.post(f"/api/projects/{project_id}/validate/hardware").json()
    runs = client.get(f"/api/projects/{project_id}/agent-runs").json()
    assert runs[0]["provider"] == "mock"

    generated = client.post(f"/api/projects/{project_id}/generate/architecture")
    assert generated.status_code == 200
    assert generated.json()["agent_artifact"] == "02_architecture/agent-analysis.md"
    assert client.post(f"/api/projects/{project_id}/generate/bom").status_code == 200
    paths_after_second_generation = {
        item["path"] for item in client.get(f"/api/projects/{project_id}/artifacts").json()
    }
    assert "02_architecture/agent-analysis.md" in paths_after_second_generation
    assert "03_hardware/agent-bom-review.md" in paths_after_second_generation
    protocol_validation = client.post(f"/api/projects/{project_id}/validate/protocol")
    assert protocol_validation.status_code == 200
    assert protocol_validation.json()["errors"] == []
    assert client.get(f"/api/projects/{project_id}/validations").status_code == 200


def test_invalid_project_and_error_handling(client):
    assert client.post("/api/projects", json={"name": "x", "description": "short"}).status_code == 422
    assert client.get("/api/projects/not-found").status_code == 404
    assert client.post("/api/agent/test").status_code == 409


def test_spec_version_update(client):
    project_id = create_project(client)["id"]
    spec = client.get(f"/api/projects/{project_id}/spec").json()
    spec["project"]["description"]["value"] = "更新后的产品描述"
    response = client.patch(f"/api/projects/{project_id}/spec", json={
        "spec": spec, "reason": "用户补充场景", "affected_modules": ["ProjectSpec", "架构"],
    })
    assert response.status_code == 200
    assert response.json()["version"] == 2


def test_requirement_confirmation_creates_audited_versions(client):
    project_id = create_project(client)["id"]

    recommendation = client.post(
        f"/api/projects/{project_id}/spec/recommendations",
        json={"question_index": 0},
    )
    assert recommendation.status_code == 200, recommendation.text
    assert len(recommendation.json()["candidates"]) == 3
    assert recommendation.json()["requires_confirmation"] is True
    assert all(
        item["verification_required"]
        for item in recommendation.json()["candidates"]
    )

    field = client.post(
        f"/api/projects/{project_id}/spec/confirmations",
        json={"field": "constraints.budget_cny", "value": 960},
    )
    assert field.status_code == 200, field.text
    assert field.json()["version"] == 2
    spec = client.get(f"/api/projects/{project_id}/spec").json()
    assert spec["constraints"]["budget_cny"]["value"] == 960
    assert spec["constraints"]["budget_cny"]["source"] == "user_provided"
    assert spec["constraints"]["budget_cny"]["verification_status"] == "USER_CONFIRMED"

    question = client.post(
        f"/api/projects/{project_id}/spec/confirmations",
        json={"question_index": 0, "answer": "使用低压桌面执行器，具体型号仍需查看数据手册"},
    )
    assert question.status_code == 200, question.text
    assert question.json()["version"] == 3
    spec = client.get(f"/api/projects/{project_id}/spec").json()
    assert spec["open_questions"][0]["verification_status"] == "USER_CONFIRMED"
    assert "具体型号仍需查看数据手册" in spec["open_questions"][0]["notes"]

    versions = client.get(f"/api/projects/{project_id}/spec/versions").json()
    assert versions[0]["reason"].startswith("确认需求问题")
    assert versions[1]["reason"] == "确认需求字段：预算"

    invalid = client.post(
        f"/api/projects/{project_id}/spec/confirmations",
        json={"field": "hardware.unknown", "value": "invented"},
    )
    assert invalid.status_code == 422
