# land model view -> FlatGeobuf
#   python fgbs.py land_model_grid_100m_view.parquet 100.fgb [--cell <size in metres, omit for parcels>]
#
# Grid cells become a point at their centre and parcels keep their polygons.

import argparse
import json

import pyarrow.dataset as ds
import pyarrow.types as pat
import shapely
from osgeo import ogr, osr

from cog import bng_corner

ogr.UseExceptions()

BNG = osr.SpatialReference()
BNG.ImportFromEPSG(27700)

# the geometry goes on the feature rather than in a field
DROP = {"geom_wkb", "geometry_wkb"}


def read_view(view):
    """Reads a view in batches."""
    return ds.dataset(view, format="parquet").scanner(batch_size=10000)


def _field_type(t):
    if pat.is_integer(t):
        return ogr.OFTInteger64
    if pat.is_floating(t):
        return ogr.OFTReal
    return ogr.OFTString


def _cell_centre(row, cell):
    """A point in the middle of the grid cell."""
    e, n = bng_corner(row["bng_ref"])
    point = ogr.Geometry(ogr.wkbPoint)
    point.AddPoint_2D(e + cell / 2, n + cell / 2)
    return point


def _parcel_geometry(row):
    """The parcel's polygon converted from EWKB to WKB."""
    return ogr.CreateGeometryFromWkb(shapely.to_wkb(shapely.from_wkb(row["geometry_wkb"])))


def _layer_geometry(cell):
    """The layer's name, its geometry type and how to get a row's geometry, for a grid or the parcels."""
    if cell:
        return f"grid_{cell}", ogr.wkbPoint, lambda row: _cell_centre(row, cell)
    return "parcels", ogr.wkbPolygon, _parcel_geometry


def write_fgb(view, path, cell=None):
    """Writes a view out as a FlatGeobuf.

    Args:
        view: the view's rows as a pyarrow scanner, with the agreed column names
        path: where to write the FlatGeobuf
        cell: the grid's cell size in metres, None for parcels
    """
    schema = view.projected_schema
    columns = [name for name in schema.names if name not in DROP]
    json_columns = {name for name in columns if name.endswith("_json")}
    layer_name, geometry_type, geometry = _layer_geometry(cell)

    # TODO: remove me, track 'null' values to flag up any issues during testing
    id_column = "bng_ref" if cell else "osid"
    nulls = 0

    out = ogr.GetDriverByName("FlatGeobuf").CreateDataSource(path)
    layer = out.CreateLayer(layer_name, BNG, geometry_type, ["SPATIAL_INDEX=YES"])
    for name in columns:
        layer.CreateField(ogr.FieldDefn(name, _field_type(schema.field(name).type)))

    for batch in view.to_batches():
        for row in batch.to_pylist():
            feature = ogr.Feature(layer.GetLayerDefn())
            null_columns = []
            for name in columns:
                value = row[name]
                if value is None:
                    continue
                if name in json_columns:
                    has_null = any("null" in entry.values() for entry in json.loads(value))
                else:
                    has_null = value == "null"
                if has_null:
                    null_columns.append(name)
                feature.SetField(name, value)
            if null_columns:
                print(f"{path}: {row[id_column]} has 'null' in {', '.join(null_columns)}")
                nulls += 1
            feature.SetGeometry(geometry(row))
            layer.CreateFeature(feature)

    print(f"{path}: {layer.GetFeatureCount()} features, {nulls} with 'null'")
    out.Close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("view")
    parser.add_argument("out")
    parser.add_argument("--cell", type=int)
    args = parser.parse_args()

    write_fgb(read_view(args.view), args.out, args.cell)


if __name__ == "__main__":
    main()
