# 10m land model view -> multiband COG and bands.json
#   python cog.py land_model_grid_10m_view.parquet out/grid [--tile-size <metres, default 10000>]
#
# A 10m cell is one pixel positioned by its bng_ref, so there is no rasterising step.
# England at 10m would be too big to process at once so it is:
# - split into tiles
# - written to a GeoTIFF per tile
# - stitched together with a VRT
# - COG generated from the VRT pointing at the GeoTIFFs
#
# Band values are all uint32 as they share a data type, and id values need it to keep their precision.
import argparse
import json
import os
import tempfile

import numpy as np
import pandas as pd
from osbng.bng_reference import BNGReference
from osbng.indexing import bng_to_xy
from osgeo import gdal

gdal.UseExceptions()

BNG = "EPSG:27700"

CELL = 10

# the digits each half of a 10m ref (SE66007500) keeps for its tile, the tile sizes are powers of ten
TILE_DIGITS = {100000: 0, 10000: 1, 1000: 2}

# the view columns, in band order
BANDS = [
    "land_cover_dominant_value",
    "land_use_dominant_value",
    "soil_dominant_value",
    "ownership_dominant_id",
    "ownership_dominant_value",
    "land_management_dominant_id",
    "protected_area_count",
]

# bands that are mapped to a class rather than having their actual value,
# these are numbered from 1, as 0 is no data
CLASS_BANDS = [
    "land_cover_dominant_value",
    "land_use_dominant_value",
    "soil_dominant_value",
    "ownership_dominant_value",
]


def bng_corner(ref):
    """A BNG square's bottom left, e.g. SE66007500 -> (466000, 475000), SE -> (400000, 400000)."""
    return bng_to_xy(BNGReference(ref))


def _class_lists(cells):
    """Each class band's labels, bandValue is index + 1 (0 is no data).

    When in the pipeline we'd do a separate query for this
    """
    classes = {}
    for col in CLASS_BANDS:
        column = cells[col]
        # TODO: remove me, checking test views for 'null' data
        nulls = (column == "null").sum()
        if nulls:
            print(f"{nulls} cells have 'null' as their {col}")
        classes[col] = sorted(column.dropna().unique())
    return classes


def tile_of(refs, tile_size):
    """The tile each 10m cell is in, the BNG square of the tile size, e.g. SE66007500 -> SE67 for 10km."""
    if not (refs.str.len() == 10).all():
        raise ValueError("expected 10m refs like SE66007500")
    digits = TILE_DIGITS[tile_size]
    return refs.str[: 2 + digits] + refs.str[6 : 6 + digits]


def _cell_corners(tile, refs):
    """Each of the tile's 10m cells bottom left corner, as eastings and northings."""

    # the refs are sliced rather than converted with osbng as this is much faster.
    # the tile's cells share its 100km square, so a cell's position is the corner plus its digits * 10, e.g:
    # SE66007500 is SE (400000, 400000) + (6600, 7500) * 10 = (466000, 475000)
    square_east, square_north = bng_corner(tile[:2])
    eastings = square_east + refs.str[2:6].astype(int).to_numpy() * CELL
    northings = square_north + refs.str[6:10].astype(int).to_numpy() * CELL
    return eastings, northings


def _band_values(cells, classes):
    """Converts the cell rows into pixel values, e.g. values[0] is every cell's band 1 value."""
    values = np.zeros((len(BANDS), len(cells)), dtype=np.uint32)
    for i, col in enumerate(BANDS):
        if col in CLASS_BANDS:
            numbers = {v: n for n, v in enumerate(classes[col], start=1)}
            values[i] = cells[col].map(numbers).fillna(0)
        else:
            values[i] = cells[col].fillna(0)
    return values


def write_tile(tile, cells, classes, tiles_dir):
    """Writes one tile's cells as a GeoTIFF and returns its path.

    Args:
        tile: the BNG square, e.g. SE67
        cells: the tile's 10m cells as a pandas DataFrame, with bng_ref and the BANDS columns
        classes: each class band's labels, e.g. {"land_cover_dominant_value": ["Conifer woodland", ...]},
            bandValue is index + 1 (0 is no data)
        tiles_dir: where the tile goes
    """
    west, _, east, north = BNGReference(tile).bng_to_bbox()
    size = (east - west) // CELL
    eastings, northings = _cell_corners(tile, cells["bng_ref"])

    # image rows are numbered down from the tile's north edge, and a cell's northing is its bottom edge,
    # e.g. in SE67 (north 480000) the cell at 479990 is row 0 and the cell at 470000 is row 999
    cols = (eastings - west) // CELL
    rows = (north - northings) // CELL - 1
    data = np.zeros((len(BANDS), size, size), dtype=np.uint32)
    data[:, rows, cols] = _band_values(cells, classes)

    path = os.path.join(tiles_dir, f"{tile}.tif")
    ds = gdal.GetDriverByName("GTiff").Create(
        path, size, size, len(BANDS), gdal.GDT_UInt32, ["COMPRESS=DEFLATE", "TILED=YES"]
    )
    ds.SetGeoTransform([west, CELL, 0, north, 0, -CELL])
    ds.SetProjection(BNG)
    for band in range(1, len(BANDS) + 1):
        ds.GetRasterBand(band).SetNoDataValue(0)
    ds.WriteArray(data)
    ds.Close()
    return path


def write_cog(path, tile_paths):
    """Stitches the tiles together with a VRT and writes it out as the COG."""
    mosaic = gdal.BuildVRT(os.path.join(os.path.dirname(tile_paths[0]), "mosaic.vrt"), tile_paths)

    # set the band descriptions so they're copied over during translate
    for band, name in enumerate(BANDS, start=1):
        mosaic.GetRasterBand(band).SetDescription(name)

    cog = gdal.Translate(
        path,
        mosaic,
        format="COG",
        creationOptions=[
            "COMPRESS=DEFLATE",
            "LEVEL=9",
            "BLOCKSIZE=256",
            "OVERVIEW_RESAMPLING=MODE",
            "BIGTIFF=IF_SAFER",
            "NUM_THREADS=ALL_CPUS",
        ],
    )
    cog.Close()
    mosaic.Close()


def bands_json(classes):
    """The bands.json the viewer uses to turn the pixel values back into labels.

    Args:
        classes: each class band's labels, bandValue is index + 1 (0 is no data)
    """
    bands = {}
    for band, col in enumerate(BANDS, start=1):
        bands[col] = {"band": band}
        if col in CLASS_BANDS:
            bands[col]["classes"] = [{"bandValue": n, "label": label} for n, label in enumerate(classes[col], start=1)]
    return bands


def build(cells, classes, cog_path, tiles_dir, tile_size=10000):
    """Writes the COG from the 10m cells and returns its bands.json.

    Args:
        cells: the 10m view as a pandas DataFrame
        classes: each class band's labels across the whole view, bandValue is index + 1 (0 is no data)
        cog_path: where to write the COG
        tiles_dir: where the tiles go while it's built
        tile_size: the BNG square size the cells are split into, in metres
    """
    cells = cells.assign(tile=tile_of(cells["bng_ref"], tile_size))
    paths = [write_tile(name, group, classes, tiles_dir) for name, group in cells.groupby("tile")]
    print(f"{len(cells)} cells in {len(paths)} tiles of {tile_size}m")

    write_cog(cog_path, paths)
    return bands_json(classes)


def write_grid_cog(view, out, tile_size=10000):
    """Writes the 10m view out as out/10.tif and out/bands.json."""
    os.makedirs(out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tiles_dir:
        cells = pd.read_parquet(view)
        bands = build(cells, _class_lists(cells), os.path.join(out, "10.tif"), tiles_dir, tile_size)

    with open(os.path.join(out, "bands.json"), "w") as f:
        json.dump(bands, f, indent=2)
        f.write("\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("view")
    parser.add_argument("out")
    parser.add_argument("--tile-size", type=int, default=10000, choices=sorted(TILE_DIGITS))
    args = parser.parse_args()

    write_grid_cog(args.view, args.out, args.tile_size)


if __name__ == "__main__":
    main()
