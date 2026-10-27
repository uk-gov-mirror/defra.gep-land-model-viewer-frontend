from schema.migration import SparkSessionLike, table_name

identifier = "32043b36-5b37-4d12-a5f7-1ff0d9f223a9"
previous_identifier = ""

name = "land_model_views"
description = """
Creates views that collate the source data for the land model parcel and grids for various resolutions.
"""


def upgrade(spark: SparkSessionLike):
    spark.sql(
        f"""
        CREATE OR REPLACE VIEW {table_name("land_model_parcel_view", schema="silver")}
        AS (
            WITH os_ngd_base AS (
                SELECT osid,
                    geometry_wkb
                FROM {table_name("ngd_land_parcel_as_of", schema="silver")}(current_timestamp())
            ),
            land_cover_intersection AS (
                SELECT osid,
                    max_by(mapped_value, intersection_pct) as dominant_value,
                    CASE
                        WHEN count(osid) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'mapped_value',
                                    coalesce(mapped_value, 'null'),
                                    'intersection_area',
                                    intersection_area,
                                    'intersection_pct',
                                    intersection_pct,
                                    'source',
                                    'UKCEH Land Cover Map',
                                    'date',
                                    created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM {table_name("parcel_land_cover_intersection", schema="silver")}
                GROUP BY osid
            ),
            land_use_intersection AS (
                SELECT osid,
                    max_by(mapped_value, intersection_pct) as dominant_value,
                    CASE
                        WHEN count(osid) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'mapped_value',
                                    coalesce(mapped_value, 'null'),
                                    'intersection_area',
                                    intersection_area,
                                    'intersection_pct',
                                    intersection_pct,
                                    'source',
                                    'OS NGD',
                                    'date',
                                    created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM {table_name("parcel_land_use_intersection", schema="silver")}
                GROUP BY osid
            ),
            soil_intersection AS (
                SELECT osid,
                    max_by(mapped_value, intersection_pct) as dominant_value,
                    CASE
                        WHEN count(osid) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'mapped_value',
                                    coalesce(mapped_value, 'null'),
                                    'intersection_area',
                                    intersection_area,
                                    'intersection_pct',
                                    intersection_pct,
                                    'source',
                                    'National Soil Map',
                                    'date',
                                    created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM {table_name("parcel_soil_intersection", schema="silver")}
                GROUP BY osid
            ),
            land_management_rpa_intersection AS (
                SELECT osid,
                    CASE
                        WHEN count(osid) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'unique_identifier',
                                    coalesce(cast(unique_identifier as string), 'null'),
                                    'intersection_area',
                                    intersection_area,
                                    'intersection_pct',
                                    intersection_pct,
                                    'source',
                                    'RPA',
                                    'date',
                                    created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM {table_name("parcel_land_management_rpa_intersection", schema="silver")}
                GROUP BY osid
            ),
            protected_areas_intersection AS (
                SELECT osid,
                    CASE
                        WHEN count(osid) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'code',
                                    coalesce(protected_area_code, 'null'),
                                    'type',
                                    coalesce(protected_area_type, 'null'),
                                    'name',
                                    coalesce(protected_area_name, 'null'),
                                    'intersection_area',
                                    intersection_area,
                                    'intersection_pct',
                                    intersection_pct,
                                    'source',
                                    'Natural England SSSI, SAC, SPA, Ramsar, NNR',
                                    'date',
                                    created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM {table_name("parcel_protected_area_intersection", schema="silver")}
                GROUP BY osid
            )
            SELECT osngdb.osid,
                osngdb.geometry_wkb,
                lci.dominant_value as land_cover_dominant_value,
                lci.intersections_json as land_cover_intersections_json,
                lui.dominant_value as land_use_dominant_value,
                lui.intersections_json as land_use_intersections_json,
                si.dominant_value as soil_dominant_value,
                si.intersections_json as soil_intersections_json,
                lmrpai.intersections_json as land_management_intersections_json,
                pai.intersections_json as protected_area_intersections_json
            FROM os_ngd_base osngdb
            LEFT JOIN land_cover_intersection lci ON lci.osid = osngdb.osid
            LEFT JOIN land_use_intersection lui ON lui.osid = osngdb.osid
            LEFT JOIN soil_intersection si ON si.osid = osngdb.osid
            LEFT JOIN land_management_rpa_intersection lmrpai ON
                lmrpai.osid = osngdb.osid
            LEFT JOIN protected_area_intersection pai ON pai.osid = osngdb.osid
        )
        """
    )

    spark.sql(
        f"""
        CREATE OR REPLACE VIEW {table_name("land_model_grid_10m_view", schema="silver")}
        AS (
            WITH grid_base AS (
                SELECT g.grid_id, g.bng_ref, g.geom_wkb
                FROM {table_name("grid", schema="silver")} g
                JOIN {table_name("grid_system", schema="silver")} gs ON g.grid_system_id = gs.id
                WHERE gs.resolution = '10M'
            ),
            land_cover_intersection AS (
                SELECT glci.grid_id,
                    first(glci.mapped_value) as dominant_value
                FROM grid_base g
                JOIN {table_name("grid_land_cover_intersection", schema="silver")} glci ON glci.grid_id = g.grid_id
                GROUP BY glci.grid_id
            ),
            land_use_intersection AS (
                SELECT glui.grid_id,
                    first(glui.mapped_value) as dominant_value
                FROM grid_base g
                JOIN {table_name("grid_land_use_intersection", schema="silver")} glui ON glui.grid_id = g.grid_id
                GROUP BY glui.grid_id
            ),
            soil_intersection AS (
                SELECT gsi.grid_id,
                    first(gsi.mapped_value) as dominant_value
                FROM grid_base g
                JOIN {table_name("grid_soil_intersection", schema="silver")} gsi ON gsi.grid_id = g.grid_id
                GROUP BY gsi.grid_id
            ),
            land_management_rpa_intersection AS (
                SELECT glmrpai.grid_id,
                    first(glmrpai.unique_identifier) as dominant_value
                FROM grid_base g
                JOIN {table_name("grid_land_management_rpa_intersection", schema="silver")} glmrpai ON
                    glmrpai.grid_id = g.grid_id
                GROUP BY glmrpai.grid_id
            ),
            protected_area_count AS (
                SELECT gpac.grid_id,
                    first(gpac.protected_area_type_count) as dominant_value
                FROM grid_base g
                JOIN {table_name("grid_protected_area_count", schema="silver")} gpac ON gpac.grid_id = g.grid_id
                GROUP BY gpac.grid_id
            )
            SELECT g.bng_ref,
                g.geom_wkb,
                lci.dominant_value as land_cover_dominant_value,
                lui.dominant_value as land_use_dominant_value,
                si.dominant_value as soil_dominant_value,
                lmrpai.dominant_value as land_management_dominant_id,
                pac.dominant_value as protected_area_count
            FROM grid_base g
            LEFT JOIN land_cover_intersection lci ON lci.grid_id = g.grid_id
            LEFT JOIN land_use_intersection lui ON lui.grid_id = g.grid_id
            LEFT JOIN soil_intersection si ON si.grid_id = g.grid_id
            LEFT JOIN land_management_rpa_intersection lmrpai ON lmrpai.grid_id = g.grid_id
            LEFT JOIN protected_area_count pac ON pac.grid_id = g.grid_id
        )
        """
    )

    grid_lower_resolution_query = f"""
        WITH grid_base AS (
                SELECT g.grid_id, g.bng_ref, g.geom_wkb
                FROM {table_name("grid", schema="silver")} g
                JOIN {table_name("grid_system", schema="silver")} gs ON g.grid_system_id = gs.id
                WHERE gs.resolution = '##RESOLUTION##'
            ),
            land_cover_intersection AS (
                SELECT glci.grid_id,
                    CASE
                        WHEN count(glci.grid_id) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'mapped_value',
                                    coalesce(glci.mapped_value, 'null'),
                                    'intersection_area',
                                    glci.intersection_area,
                                    'intersection_pct',
                                    glci.intersection_pct,
                                    'source',
                                    'UKCEH Land Cover Map',
                                    'date',
                                    glci.created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM grid_base g
                JOIN {table_name("grid_land_cover_intersection", schema="silver")} glci ON glci.grid_id = g.grid_id
                GROUP BY glci.grid_id
            ),
            land_use_intersection AS (
                SELECT glui.grid_id,
                    CASE
                        WHEN count(glui.grid_id) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'mapped_value',
                                    coalesce(glui.mapped_value, 'null'),
                                    'intersection_area',
                                    glui.intersection_area,
                                    'intersection_pct',
                                    glui.intersection_pct,
                                    'source',
                                    'OS NGD',
                                    'date',
                                    glui.created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM grid_base g
                JOIN {table_name("grid_land_use_intersection", schema="silver")} glui ON glui.grid_id = g.grid_id
                GROUP BY glui.grid_id
            ),
            soil_intersection AS (
                SELECT gsi.grid_id,
                    CASE
                        WHEN count(gsi.grid_id) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'mapped_value',
                                    coalesce(gsi.mapped_value, 'null'),
                                    'intersection_area',
                                    gsi.intersection_area,
                                    'intersection_pct',
                                    gsi.intersection_pct,
                                    'source',
                                    'National Soil Map',
                                    'date',
                                    gsi.created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM grid_base g
                JOIN {table_name("grid_soil_intersection", schema="silver")} gsi ON gsi.grid_id = g.grid_id
                GROUP BY gsi.grid_id
            ),
            land_management_rpa_intersection AS (
                SELECT glmrpai.grid_id,
                    CASE
                        WHEN count(glmrpai.grid_id) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'unique_identifier',
                                    coalesce(cast(glmrpai.unique_identifier as string), 'null'),
                                    'intersection_area',
                                    glmrpai.intersection_area,
                                    'intersection_pct',
                                    glmrpai.intersection_pct,
                                    'source',
                                    'RPA',
                                    'date',
                                    glmrpai.created_at
                                )
                            )
                        )
                    END as intersections_json
                FROM grid_base g
                JOIN {table_name("grid_land_management_rpa_intersection", schema="silver")} glmrpai ON
                    glmrpai.grid_id = g.grid_id
                GROUP BY glmrpai.grid_id
            ),
            protected_area_count AS (
                SELECT gpac.grid_id,
                    CASE
                        WHEN count(gpac.grid_id) = 0 THEN NULL
                        ELSE to_json(
                            collect_set(
                                named_struct(
                                    'count',
                                    coalesce(cast(gpac.protected_area_type_count as string), 'null'),
                                    'source',
                                    'Natural England SSSI, SAC, SPA, Ramsar, NNR',
                                    'date',
                                    gpac.created_at
                                )
                            )
                        )
                    END as counts_json
                FROM grid_base g
                JOIN {table_name("grid_protected_area_count", schema="silver")} gpac ON gpac.grid_id = g.grid_id
                GROUP BY gpac.grid_id
            )
        SELECT g.bng_ref,
            g.geom_wkb,
            lci.intersections_json as land_cover_intersections_json,
            lui.intersections_json as land_use_intersections_json,
            si.intersections_json as soil_intersections_json,
            lmrpai.intersections_json as land_management_intersections_json,
            pac.counts_json as protected_area_counts_json
        FROM grid_base g
        LEFT JOIN land_cover_intersection lci ON lci.grid_id = g.grid_id
        LEFT JOIN land_use_intersection lui ON lui.grid_id = g.grid_id
        LEFT JOIN soil_intersection si ON si.grid_id = g.grid_id
        LEFT JOIN land_management_rpa_intersection lmrpai ON
            lmrpai.grid_id = g.grid_id
        LEFT JOIN protected_area_count pac ON pac.grid_id = g.grid_id
    """

    spark.sql(
        f"""
        CREATE OR REPLACE VIEW {table_name("land_model_grid_100m_view", schema="silver")}
        AS (
            {grid_lower_resolution_query.replace("##RESOLUTION##", "100M")}
        )
        """
    )

    spark.sql(
        f"""
        CREATE OR REPLACE VIEW {table_name("land_model_grid_1km_view", schema="silver")}
        AS (
            {grid_lower_resolution_query.replace("##RESOLUTION##", "1KM")}
        )
        """
    )

    spark.sql(
        f"""
        CREATE OR REPLACE VIEW {table_name("land_model_grid_10km_view", schema="silver")}
        AS (
            {grid_lower_resolution_query.replace("##RESOLUTION##", "10KM")}
        )
        """
    )

    spark.sql(
        f"""
        CREATE OR REPLACE VIEW {table_name("land_model_grid_100km_view", schema="silver")}
        AS (
            {grid_lower_resolution_query.replace("##RESOLUTION##", "100KM")}
        )
        """
    )


def downgrade(spark: SparkSessionLike):
    spark.sql(f"DROP VIEW IF EXISTS {table_name('land_model_parcel_view', schema='silver')}")
    spark.sql(f"DROP VIEW IF EXISTS {table_name('land_model_grid_10m_view', schema='silver')}")
    spark.sql(f"DROP VIEW IF EXISTS {table_name('land_model_grid_100m_view', schema='silver')}")
    spark.sql(f"DROP VIEW IF EXISTS {table_name('land_model_grid_1km_view', schema='silver')}")
    spark.sql(f"DROP VIEW IF EXISTS {table_name('land_model_grid_10km_view', schema='silver')}")
    spark.sql(f"DROP VIEW IF EXISTS {table_name('land_model_grid_100km_view', schema='silver')}")
