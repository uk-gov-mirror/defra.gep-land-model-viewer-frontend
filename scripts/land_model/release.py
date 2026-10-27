# land model release from the view exports
#   python release.py <views dir> <out dir>
#
# writes <out>/grid (10.tif, bands.json, 100/1000/10000.fgb) and <out>/parcels (data.fgb),
# each with style.json and manifest.json

import argparse
import json
import os
from datetime import UTC, datetime

import cog
import fgbs

# no 100km, the sample area doesn't cover it
COARSE = [("100m", 100), ("1km", 1000), ("10km", 10000)]

GRID_STYLE = {
    "opacity": 0.01,
    "themes": [
        {
            "label": "Grid squares",
            "type": "uniform",
            "band": 1,
            "classes": [{"bandValue": 1, "label": "Grid square", "fill": [0, 133, 49, 1]}],
        }
    ],
}

PARCEL_STYLE = {
    "themes": [
        {
            "label": "OS features",
            "type": "uniform",
            "band": 1,
            "classes": [
                {
                    "bandValue": 1,
                    "label": "OS feature",
                    "fill": [0, 133, 49, 0.12],
                    "stroke": {"color": [0, 106, 39, 0.6], "width": 1.5},
                }
            ],
        }
    ]
}


def _sources():
    """Each theme's source and date, as last seen in the views.

    TODO: lookup from bronze.foundational_datasets
    """
    return {
        "land_cover": {"name": "UKCEH Land Cover Map", "date": "2026-10-21T15:20:31.309Z"},
        "land_use": {"name": "OS NGD", "date": "2026-10-22T11:17:40.971Z"},
        "soil": {"name": "National Soil Map", "date": "2026-10-22T11:42:03.320Z"},
        "protected_area": {"name": "Natural England SSSI, SAC, SPA, Ramsar, NNR", "date": "2026-10-21T15:07:42.158Z"},
        # not in the views yet, placeholders:
        "land_management": {"name": "RPA", "date": "2026-10-22T00:00:00.000Z"},
        "ownership": {"name": "HM Land Registry", "date": "2026-10-22T00:00:00.000Z"},
    }


def _write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def _write_release(out, style, files, sources):
    _write_json(os.path.join(out, "style.json"), style)
    _write_json(
        os.path.join(out, "manifest.json"),
        {
            "generatedAt": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "sources": sources,
            "files": dict.fromkeys(["style.json", *files]),
        },
    )


def grid(views, out):
    out = os.path.join(out, "grid")
    os.makedirs(out, exist_ok=True)

    cog.write_grid_cog(os.path.join(views, "land_model_grid_10m_view.parquet"), out)
    for name, cell in COARSE:
        fgbs.write_fgb(
            fgbs.read_view(os.path.join(views, f"land_model_grid_{name}_view.parquet")),
            os.path.join(out, f"{cell}.fgb"),
            cell,
        )

    files = ["bands.json", "10.tif", *[f"{cell}.fgb" for _, cell in COARSE]]
    _write_release(out, GRID_STYLE, files, _sources())


def parcels(views, out):
    out = os.path.join(out, "parcels")
    os.makedirs(out, exist_ok=True)

    view = os.path.join(views, "land_model_parcel_view.parquet")
    fgbs.write_fgb(fgbs.read_view(view), os.path.join(out, "data.fgb"))
    _write_release(out, PARCEL_STYLE, ["data.fgb"], _sources())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("views")
    parser.add_argument("out")
    args = parser.parse_args()

    grid(args.views, args.out)
    parcels(args.views, args.out)


if __name__ == "__main__":
    main()
