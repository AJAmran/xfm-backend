export interface AppErrorType {
  message: string;
  statusCode: number;
  errors: { field: string; message: string }[];
}

export function appError(
  message: string,
  statusCode = 500,
  errors: { field: string; message: string }[] = [],
): AppErrorType & Error {
  const error = new Error(message) as AppErrorType & Error;
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
}

export function validationError(
  message: string,
  errors: { field: string; message: string }[] = [],
): AppErrorType & Error {
  return appError(message, 422, errors);
}
