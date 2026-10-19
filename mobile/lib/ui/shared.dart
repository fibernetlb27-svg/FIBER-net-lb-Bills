import 'package:flutter/material.dart';

import 'theme.dart';

class FiberBrand extends StatelessWidget {
  const FiberBrand({super.key, this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    if (compact) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              'FIBER net lb',
              style: TextStyle(
                color: colors.onSurface,
                fontSize: 20,
                fontWeight: FontWeight.w900,
                letterSpacing: -0.6,
              ),
            ),
          ),
          const SizedBox(width: 2),
          const Icon(Icons.wifi_rounded, color: FiberColors.orange, size: 24),
        ],
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: FiberColors.blue,
            borderRadius: BorderRadius.circular(compact ? 11 : 15),
          ),
          child: Padding(
            padding: EdgeInsets.all(compact ? 8 : 13),
            child: Icon(
              Icons.wifi_rounded,
              color: Colors.white,
              size: compact ? 24 : 34,
            ),
          ),
        ),
        const SizedBox(width: 11),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'FIBER NET LB',
                style: TextStyle(
                  color: colors.onSurface,
                  fontSize: compact ? 16 : 23,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.6,
                ),
              ),
              if (!compact)
                const Text(
                  'Smart solution to stay ahead.',
                  style: TextStyle(
                    color: FiberColors.orange,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class FiberPanel extends StatelessWidget {
  const FiberPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.backgroundColor,
    this.borderColor,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? backgroundColor;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: backgroundColor ?? scheme.surface,
      surfaceTintColor: Colors.transparent,
      shadowColor: scheme.shadow.withAlpha(20),
      elevation: 1,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(22),
        side: BorderSide(color: borderColor ?? scheme.outlineVariant),
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

class FiberPreviewBadge extends StatelessWidget {
  const FiberPreviewBadge({super.key});

  static double barHeight(BuildContext context) {
    final available = MediaQuery.sizeOf(context).width - 115;
    final painter = TextPainter(
      text: TextSpan(
        text: 'DESIGN PREVIEW · Sample data',
        style: Theme.of(context).textTheme.labelSmall,
      ),
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
    )..layout(maxWidth: available > 24 ? available : 24);
    final textHeight = painter.height;
    painter.dispose();
    return (textHeight > 17 ? textHeight : 17) + 30;
  }

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    decoration: BoxDecoration(
      color: FiberColors.orange.withAlpha(18),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: FiberColors.orange.withAlpha(70)),
    ),
    child: Row(
      children: [
        const Icon(
          Icons.auto_awesome_outlined,
          size: 17,
          color: FiberColors.orange,
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Text(
            'DESIGN PREVIEW · Sample data',
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ),
        const SizedBox(width: 8),
        const Tooltip(
          message: 'No server is connected. No real records can be changed.',
          child: Icon(Icons.cloud_off_outlined, size: 17),
        ),
      ],
    ),
  );
}

class FiberTemporaryHttpBanner extends StatelessWidget {
  const FiberTemporaryHttpBanner({super.key});

  static const title = 'HTTP TEST · NOT ENCRYPTED';
  static const message = 'Password and data can be exposed. View only.';

  static double barHeight(BuildContext context) {
    final available = MediaQuery.sizeOf(context).width - 96;
    double measure(String text, TextStyle? style) {
      final painter = TextPainter(
        text: TextSpan(text: text, style: style),
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
      )..layout(maxWidth: available > 24 ? available : 24);
      final height = painter.height;
      painter.dispose();
      return height;
    }

    return measure(title, Theme.of(context).textTheme.labelSmall) +
        measure(message, Theme.of(context).textTheme.bodySmall) +
        38;
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.errorContainer,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              Icons.lock_open_rounded,
              size: 21,
              color: colors.onErrorContainer,
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.labelSmall
                        ?.copyWith(color: colors.onErrorContainer),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    message,
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: colors.onErrorContainer),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FiberMessage extends StatelessWidget {
  const FiberMessage({
    super.key,
    required this.title,
    required this.message,
    this.icon = Icons.info_outline_rounded,
    this.isError = false,
    this.onRetry,
  });

  final String title;
  final String message;
  final IconData icon;
  final bool isError;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final foreground = isError ? colors.onErrorContainer : colors.onSurface;
    return Semantics(
      liveRegion: isError,
      child: FiberPanel(
        padding: const EdgeInsets.all(17),
        backgroundColor: isError
            ? colors.errorContainer
            : colors.surfaceContainerLow,
        borderColor: isError ? colors.error.withAlpha(60) : null,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              icon,
              color: isError ? colors.error : colors.primary,
              size: 24,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.titleSmall
                        ?.copyWith(color: foreground),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    message,
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: foreground, height: 1.5),
                  ),
                  if (onRetry != null) ...[
                    const SizedBox(height: 6),
                    TextButton.icon(
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Try again'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FiberEmptyState extends StatelessWidget {
  const FiberEmptyState({
    super.key,
    required this.title,
    required this.message,
    this.icon = Icons.receipt_long_outlined,
  });

  final String title;
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) => FiberPanel(
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 35),
    child: Column(
      children: [
        CircleAvatar(
          radius: 29,
          backgroundColor: Theme.of(context).colorScheme.surfaceContainerLow,
          child: Icon(
            icon,
            size: 28,
            color: Theme.of(context).colorScheme.primary,
          ),
        ),
        const SizedBox(height: 15),
        Text(
          title,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        Text(
          message,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(height: 1.5),
        ),
      ],
    ),
  );
}
