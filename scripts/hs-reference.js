import fs from "fs";
import path from "path";

const COLUMN_KEYS = ["joist", "truss", "multi"];
const COLUMN_TO_CONNECTION = {
  joist: "joist_flush_top",
  truss: "truss_flush_bottom",
  multi: "multi_truss_flush_bottom",
};

/** Parameters Map.csv label → hanger-selector-reference uiLabel */
const CSV_LABEL_ALIASES = {
  "ANSI/TPI 1 Evaluation": "ANSI TPI",
  "Upload (ASD)": "Uplift (ASD)",
  "Vertical Width (King Post)": "King Post Width",
  "Bottom Chord Height": "King Post Height",
  "Total Height": "King Post Height",
  "Heel Height": "Depth",
  "Bottom Chord Width": "Width",
  "High, Low, Center Flush": "Offset Direction",
  "Offset Direction (Top Flange Only)": "Offset Direction",
  "Member Type (Controlled by Jack inputs)": "Member Type",
  "Lumber Species (Controlled by Jack inputs)": "Lumber Species",
};

export function loadHsReference(dataOutDir) {
  const refPath = path.join(dataOutDir, "hanger-selector-reference.json");
  if (!fs.existsSync(refPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(refPath, "utf8"));
}

export function connectionUiLabel(hsRef, column) {
  const id = COLUMN_TO_CONNECTION[column];
  const match = hsRef?.connectionTypes?.find((entry) => entry.id === id);
  return match?.uiLabel ?? null;
}

export function enumLabel(hsRef, enumKey, value) {
  const list = hsRef?.enums?.[enumKey];
  if (!list) return null;
  const match = list.find((entry) => entry.value === value);
  return match?.label ?? null;
}

export function defaultApiBody(hsRef, column) {
  const id = COLUMN_TO_CONNECTION[column];
  return hsRef?.exampleRequests?.[id] ?? null;
}

function fieldAppliesToColumn(field, column) {
  if (!field.appliesTo || field.appliesTo.length === 0) {
    return true;
  }
  return field.appliesTo.includes(COLUMN_TO_CONNECTION[column]);
}

function resolveUiLabel(csvLabel) {
  return CSV_LABEL_ALIASES[csvLabel] ?? csvLabel;
}

/** Build lookup: csvLabel → { joist, truss, multi } → { apiField, section } */
export function buildParameterFieldMap(hsRef) {
  const map = {};
  if (!hsRef?.uiSections) {
    return map;
  }

  for (const section of hsRef.uiSections) {
    for (const field of section.fields ?? []) {
      const uiLabel = field.uiLabel;
      if (!uiLabel) continue;

      for (const column of COLUMN_KEYS) {
        if (!fieldAppliesToColumn(field, column)) {
          continue;
        }

        for (const [csvLabel, alias] of Object.entries(CSV_LABEL_ALIASES)) {
          if (alias === uiLabel) {
            if (!map[csvLabel]) map[csvLabel] = {};
            map[csvLabel][column] = {
              apiField: field.apiField,
              sectionId: section.id,
              sectionLabel: section.uiLabel,
              type: field.type,
              enumKey: field.enumKey ?? null,
            };
          }
        }

        if (!map[uiLabel]) map[uiLabel] = {};
        map[uiLabel][column] = {
          apiField: field.apiField,
          sectionId: section.id,
          sectionLabel: section.uiLabel,
          type: field.type,
          enumKey: field.enumKey ?? null,
        };
      }
    }
  }

  return map;
}

export function resolveFieldMeta(fieldMap, csvLabel, column) {
  const direct = fieldMap[csvLabel]?.[column];
  if (direct) return direct;
  const aliased = fieldMap[resolveUiLabel(csvLabel)]?.[column];
  return aliased ?? null;
}

export function materialLabelFromRef(hsRef, column, species) {
  const materialEnum =
    column === "joist"
      ? { SP: 3, DF: 1, HF: 2, SPF: 4 }
      : { SP: 7, DF: 5, HF: 6, SPF: 8 };
  const value = materialEnum[species] ?? (column === "joist" ? 3 : 7);
  return enumLabel(hsRef, "material", value) ?? species;
}

export function jobSettingDefaults(hsRef, column) {
  const example = defaultApiBody(hsRef, column);
  if (!example) {
    return {
      hangerType: "All Types",
      fastenerType: "All Types",
      downloadDuration: "Floor / standard (CD=1.0)",
      upliftDuration: "Wind / seismic (CD=1.6)",
      ansiTpi: "No",
    };
  }

  return {
    hangerType: enumLabel(hsRef, "style", example.style) ?? "All Types",
    fastenerType: enumLabel(hsRef, "fastenerType", example.fastenerType) ?? "All Types",
    downloadDuration:
      enumLabel(hsRef, "durationType", example.designInformations?.downloadDurationType) ??
      "Floor / standard (CD=1.0)",
    upliftDuration:
      enumLabel(hsRef, "durationType", example.designInformations?.upliftLoadDurationType) ??
      "Wind / seismic (CD=1.6)",
    ansiTpi: enumLabel(hsRef, "ansitpi", example.ansitpi ?? 0) ?? "No",
  };
}

export function describeMultiConfiguration(seats) {
  const slots = [];
  if (seats.left) slots.push("Left");
  if (seats.center) slots.push("Center");
  if (seats.right) slots.push("Right");
  if (slots.length === 0) return "";
  return slots.join(" + ");
}
