import { Data, Datum } from "../types/data"

interface DatumV1 extends Omit<Datum, 'rels'> {
  rels: {
    father?: string;
    mother?: string;
    spouses?: string[];
    children?: string[];

    parents?: string[];
  };
}

export function convertV1toV2(data: DatumV1[]) {
  data.forEach(d => {
    if (!d.rels.parents) d.rels.parents = []
    if (d.rels.father) d.rels.parents.push(d.rels.father)
    if (d.rels.mother) d.rels.parents.push(d.rels.mother)
    delete d.rels.father
    delete d.rels.mother
  })
  return data
}