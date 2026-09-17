from sqlalchemy import inspect

from app.db.session import open_project_db


def test_migrations_create_schema(project_dir):
    engine = open_project_db(project_dir)
    names = set(inspect(engine).get_table_names())
    expected = {"project", "source", "image", "box", "dataset", "dataset_image", "model", "job", "query_run"}
    assert expected <= names


def test_open_twice_is_idempotent(project_dir):
    open_project_db(project_dir).dispose()
    engine = open_project_db(project_dir)
    assert "project" in inspect(engine).get_table_names()
