import 'package:flutter/foundation.dart';

/// Presentation types. These contain no credentials, network calls or ledger writes.
enum AppRole { admin, cashier, support }

enum BusinessKind { all, users, resellers, other }

enum ActivityStatus { completed, pending, refunded, failed }

@immutable
class BusinessOption {
  const BusinessOption({
    required this.id,
    required this.name,
    required this.kind,
  });

  final String id;
  final String name;
  final BusinessKind kind;
}

@immutable
class DashboardViewModel {
  const DashboardViewModel({
    this.revenueCents,
    this.internetCostCents,
    this.cashCents,
    this.whishCents,
    this.whishFeesCents,
    this.otherExpensesCents,
    this.netProfitBeforeOtherCents,
    this.netProfitAfterOtherCents,
    this.bandwidthCostCents,
    this.periodLabel = 'Current month',
    this.revenueHint = 'Recorded transaction revenue',
    this.netProfitHint = 'Direct costs and Whish fees are deducted once.',
  });

  final int? revenueCents;
  final int? internetCostCents;
  final int? cashCents;
  final int? whishCents;
  final int? whishFeesCents;
  final int? otherExpensesCents;

  /// A trusted backend result before optional other expenses, not gross revenue.
  final int? netProfitBeforeOtherCents;
  final int? netProfitAfterOtherCents;
  final int? bandwidthCostCents;
  final String periodLabel;
  final String revenueHint;
  final String netProfitHint;
}

@immutable
class ActivityItem {
  const ActivityItem({
    required this.id,
    required this.title,
    required this.description,
    required this.amountCents,
    required this.dateLabel,
    required this.status,
    this.paymentLabel,
    this.operatorName,
    this.renewalStatusLabel,
    this.renewalMessage,
  });

  final String id;
  final String title;
  final String description;
  final int? amountCents;
  final String dateLabel;
  final ActivityStatus status;
  final String? paymentLabel;
  final String? operatorName;
  final String? renewalStatusLabel;
  final String? renewalMessage;
}

@immutable
class CustomerItem {
  const CustomerItem({
    required this.id,
    required this.username,
    required this.name,
    this.planLabel,
    this.statusLabel,
    this.expiryLabel,
    this.balanceCents,
  });

  final String id;
  final String username;
  final String name;
  final String? planLabel;
  final String? statusLabel;
  final String? expiryLabel;
  final int? balanceCents;
}

@immutable
class ResellerItem {
  const ResellerItem({
    required this.id,
    required this.username,
    required this.name,
    this.balanceCents,
    this.moneyAddedCents,
    this.moneyCollectedCents,
    this.toCollectCents,
  });

  final String id;
  final String username;
  final String name;
  final int? balanceCents;
  final int? moneyAddedCents;
  final int? moneyCollectedCents;
  final int? toCollectCents;
}

@immutable
class WorkspaceViewModel {
  const WorkspaceViewModel({
    required this.employeeName,
    required this.username,
    required this.role,
    required this.serverLabel,
    required this.businesses,
    required this.selectedBusinessId,
    this.dashboard = const DashboardViewModel(),
    this.bills = const [],
    this.receipts = const [],
    this.customers = const [],
    this.resellers = const [],
    this.loading = false,
    this.errorMessage,
    this.lastSyncedLabel,
    this.previewMode = false,
    this.hasLoadedData = false,
    this.billsMessage,
    this.receiptsMessage,
    this.customersMessage,
    this.resellersMessage,
    this.employeeScopeLabel,
    this.temporaryHttpActive = false,
  });

  final String employeeName;
  final String username;
  final AppRole role;
  final String serverLabel;
  final List<BusinessOption> businesses;
  final String? selectedBusinessId;
  final DashboardViewModel dashboard;
  final List<ActivityItem> bills;
  final List<ActivityItem> receipts;
  final List<CustomerItem> customers;
  final List<ResellerItem> resellers;
  final bool loading;
  final String? errorMessage;
  final String? lastSyncedLabel;
  final bool previewMode;
  final bool hasLoadedData;
  final String? billsMessage;
  final String? receiptsMessage;
  final String? customersMessage;
  final String? resellersMessage;
  final String? employeeScopeLabel;
  final bool temporaryHttpActive;

  BusinessOption? get selectedBusiness {
    for (final business in businesses) {
      if (business.id == selectedBusinessId) return business;
    }
    return null;
  }
}

@immutable
class SignInInput {
  const SignInInput({
    required this.endpoint,
    required this.username,
    required this.password,
    this.allowTemporaryHttp = false,
  });

  final String endpoint;
  final String username;
  final String password;
  final bool allowTemporaryHttp;
}

/// UI-only validation for the explicitly configured Android test origin.
/// The API client independently enforces the same boundary before networking.
Uri? canonicalTemporaryHttpEndpoint(String value) {
  try {
    final endpoint = Uri.tryParse(value.trim());
    if (endpoint == null ||
        endpoint.scheme != 'http' ||
        !endpoint.hasAuthority ||
        !endpoint.hasPort ||
        endpoint.authority.contains('@') ||
        endpoint.hasQuery ||
        endpoint.hasFragment ||
        (endpoint.path.isNotEmpty && endpoint.path != '/')) {
      return null;
    }
    final octets = endpoint.host.split('.');
    if (octets.length != 4 ||
        octets.any(
          (part) =>
              !RegExp(r'^(0|[1-9][0-9]{0,2})$').hasMatch(part) ||
              int.parse(part) > 255,
        )) {
      return null;
    }
    if (endpoint.port < 1 || endpoint.port > 65535) return null;
    final origin = 'http://${endpoint.host}:${endpoint.port}';
    if (endpoint.authority != '${endpoint.host}:${endpoint.port}' ||
        (value.trim() != origin && value.trim() != '$origin/'))
      return null;
    return Uri.parse(origin);
  } on FormatException {
    return null;
  }
}

bool matchesTemporaryHttpEndpoint(String value, String? configured) {
  if (configured == null || configured.isEmpty) return false;
  final endpoint = canonicalTemporaryHttpEndpoint(value);
  final allowed = canonicalTemporaryHttpEndpoint(configured);
  return endpoint != null && allowed != null && endpoint == allowed;
}

String roleLabel(AppRole role) => switch (role) {
  AppRole.admin => 'Admin',
  AppRole.cashier => 'Cashier',
  AppRole.support => 'Support',
};

/// Formats integer cents without floating point rounding or locale dependencies.
String formatUsd(int? cents) {
  if (cents == null) return '—';
  final value = cents.abs();
  final whole = (value ~/ 100).toString();
  final buffer = StringBuffer();
  for (var index = 0; index < whole.length; index++) {
    if (index > 0 && (whole.length - index) % 3 == 0) buffer.write(',');
    buffer.write(whole[index]);
  }
  final fraction = (value % 100).toString().padLeft(2, '0');
  return '${cents < 0 ? '-' : ''}\$$buffer.$fraction';
}
