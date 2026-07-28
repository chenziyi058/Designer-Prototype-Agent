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
