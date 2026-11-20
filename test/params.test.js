import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryOf } from '../js/model/params.js';
test('kategori untuk ID gaya baru dan gaya lama', () => {
  for (const [id, c] of [['ParamAngleX', 'Head'], ['PARAM_ANGLE_X', 'Head'], ['PARAM_EYE_L_OPEN', 'Eyes'], ['ParamMouthForm', 'Face'], ['PARAM_BROW_L_Y', 'Face'],
    ['PARAM_BODY_ANGLE_X', 'Body'], ['ParamBreath', 'Body'], ['PARAM_ARM_L', 'Arms'], ['ParamHairFront', 'Other']]) assert.equal(categoryOf(id), c, id);
});
