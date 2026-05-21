import { validateRequest } from '.';
import { isMongoId, isMaxRequired, isRequired } from '../../utils/validator.utils';

export const createSessionValidator = [
  isRequired('targetIdentifier'),
  isMaxRequired({ key: 'targetContext', limit: 1000 }),
  isRequired('targetName', true),
  ...validateRequest,
];

export const sessionIdParamValidator = [
  isMongoId('id'),
  ...validateRequest,
];
