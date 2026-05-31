import { validateRequest } from '.';
import { isMongoId, isMaxRequired, isRequired } from '../../utils/validator.utils';

export const createSessionValidator = [
  isRequired('targetIdentifier'),
  isMaxRequired({ key: 'targetContext', limit: 1000 }),
  isRequired('targetName', true),
  isMongoId('decoyAccountId', true),
  ...validateRequest,
];

export const sessionIdParamValidator = [
  isMongoId('id'),
  ...validateRequest,
];

export const setObjectiveValidator = [
  isMongoId('id'),
  isMaxRequired({ key: 'objective', limit: 500 }),
  ...validateRequest,
];

export const setNudgeValidator = [
  isMongoId('id'),
  isMaxRequired({ key: 'nudge', limit: 500 }),
  ...validateRequest,
];
