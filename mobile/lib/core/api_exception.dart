enum ApiFailure {
  configuration,
  connection,
  timeout,
  compatibility,
  authentication,
  permission,
  malformedResponse,
  rejected,
  sessionChanged,
}

/// Safe, user-facing failures. Never includes request bodies or credentials.
class FiberApiException implements Exception {
  const FiberApiException(this.kind, this.message, {this.statusCode});

  final ApiFailure kind;
  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}
