export enum ApiResponseStatus {
  OK = "OK",
  ERROR = "ERROR",
}

export interface ApiResponse {
  status: ApiResponseStatus;
}

export interface ApiSuccessResponse extends ApiResponse {
  status: ApiResponseStatus.OK;
}

export interface ApiErrorResponse extends ApiResponse {
  status: ApiResponseStatus.ERROR;
  message: string;
  code: string;
}
