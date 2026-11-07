"""
create initial tables

Revision ID: 20261107_0100
Revises:
Create Date: 2026-11-07 13:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_0100"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicles",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("registration_number", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_vehicles_id"), "vehicles", ["id"], unique=False)
    op.create_index(op.f("ix_vehicles_registration_number"), "vehicles", ["registration_number"], unique=True)

    op.create_table(
        "geofences",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("coordinates", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_geofences_id"), "geofences", ["id"], unique=False)

    op.create_table(
        "vehicle_locations",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_vehicle_locations_id"), "vehicle_locations", ["id"], unique=False)
    op.create_index(op.f("ix_vehicle_locations_vehicle_id"), "vehicle_locations", ["vehicle_id"], unique=False)
    op.create_index(op.f("ix_vehicle_locations_timestamp"), "vehicle_locations", ["timestamp"], unique=False)

    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        sa.Column("geofence_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_read", sa.String(length=10), nullable=False, server_default="unread"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["geofence_id"], ["geofences.id"], ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_alerts_id"), "alerts", ["id"], unique=False)
    op.create_index(op.f("ix_alerts_vehicle_id"), "alerts", ["vehicle_id"], unique=False)
    op.create_index(op.f("ix_alerts_geofence_id"), "alerts", ["geofence_id"], unique=False)
    op.create_index(op.f("ix_alerts_event_time"), "alerts", ["event_time"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_alerts_event_time"), table_name="alerts")
    op.drop_index(op.f("ix_alerts_geofence_id"), table_name="alerts")
    op.drop_index(op.f("ix_alerts_vehicle_id"), table_name="alerts")
    op.drop_index(op.f("ix_alerts_id"), table_name="alerts")
    op.drop_table("alerts")

    op.drop_index(op.f("ix_vehicle_locations_timestamp"), table_name="vehicle_locations")
    op.drop_index(op.f("ix_vehicle_locations_vehicle_id"), table_name="vehicle_locations")
    op.drop_index(op.f("ix_vehicle_locations_id"), table_name="vehicle_locations")
    op.drop_table("vehicle_locations")

    op.drop_index(op.f("ix_geofences_id"), table_name="geofences")
    op.drop_table("geofences")

    op.drop_index(op.f("ix_vehicles_registration_number"), table_name="vehicles")
    op.drop_index(op.f("ix_vehicles_id"), table_name="vehicles")
    op.drop_table("vehicles")
