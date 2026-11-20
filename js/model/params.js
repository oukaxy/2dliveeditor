export function categoryOf(id) {
  if (/^ParamAngle/.test(id)) return 'Head';
  if (/^ParamEye/.test(id)) return 'Eyes';
  if (/^ParamBrow|^ParamMouth|^ParamCheek/.test(id)) return 'Face';
  if (/^ParamBody|^ParamBreath/.test(id)) return 'Body';
  if (/^ParamArm|^ParamHand/.test(id)) return 'Arms';
  return 'Other';
}
export function readParams(model) {
  const p = model.internalModel.coreModel._model.parameters, out = [];
  for (let i = 0; i < p.count; i++) out.push({ id: p.ids[i], min: p.minimumValues[i], max: p.maximumValues[i], def: p.defaultValues[i], cat: categoryOf(p.ids[i]) });
  return out;
}
