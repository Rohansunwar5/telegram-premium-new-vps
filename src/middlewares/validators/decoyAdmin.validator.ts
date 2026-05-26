import { validateRequest } from '.';
import { isRequired, isNumeric, isMongoId } from '../../utils/validator.utils';

export const addAccountValidator = [
  isRequired('phoneNumber'),
  isNumeric('apiId'),
  isRequired('apiHash'),
  isRequired('sessionString'),
  ...validateRequest,
];

export const accountIdParamValidator = [
  isMongoId('id'),
  ...validateRequest,
];

export const updateSessionStringValidator = [
  isMongoId('id'),
  isRequired('sessionString'),
  ...validateRequest,
];
