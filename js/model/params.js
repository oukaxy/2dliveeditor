/** Mengenali ID gaya Cubism 3+ (ParamAngleX) maupun gaya lama (PARAM_ANGLE_X). */
export function categoryOf(id) {
  const n = id.replace(/_/g, '').toLowerCase();
  if (/^paramangle/.test(n)) return 'Head';
  if (/^parameye/.test(n)) return 'Eyes';
  if (/^param(brow|mouth|cheek)/.test(n)) return 'Face';
  if (/^param(body|breath)/.test(n)) return 'Body';
  if (/^param(arm|hand)/.test(n)) return 'Arms';
  return 'Other';
}
export function readParams(model) {
  const p = model.internalModel.coreModel._model.parameters, out = [];
  for (let i = 0; i < p.count; i++) out.push({ id: p.ids[i], min: p.minimumValues[i], max: p.maximumValues[i], def: p.defaultValues[i], cat: categoryOf(p.ids[i]) });
  return out;
}
