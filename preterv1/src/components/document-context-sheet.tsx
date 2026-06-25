import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';
import { DocumentContext, fetchDocumentContext } from '@/lib/documents';

type DocumentContextSheetProps = {
  visible: boolean;
  documentId: string;
  onClose: () => void;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd} ${hh}:${min}`;
}

// Doc Detail PRD 6장 (SCR-D-05) — 학습된 자료 보기 바텀시트. 열릴 때마다 최신 상태로 재조회.
export function DocumentContextSheet({ visible, documentId, onClose }: DocumentContextSheetProps) {
  const [loading, setLoading] = useState(true);
  const [contexts, setContexts] = useState<DocumentContext[]>([]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchDocumentContext(documentId)
      .then(setContexts)
      .catch(() => setContexts([]))
      .finally(() => setLoading(false));
  }, [visible, documentId]);

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>학습된 자료</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="닫기">
          <Text style={styles.closeIcon}>×</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerMessage}>
          <ActivityIndicator color={Brand.primary} />
        </View>
      ) : contexts.length === 0 ? (
        <View style={styles.centerMessage}>
          <Text style={styles.emptyText}>아직 학습된 내용이 없어요</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {contexts.map((ctx) => (
            <View key={ctx.id} style={styles.ctxBlock}>
              <View style={styles.ctxHeader}>
                <View style={[styles.typeBadge, ctx.priority ? styles.typeBadgeText : styles.typeBadgeFile]}>
                  <Text style={styles.typeBadgeLabel}>{ctx.priority ? '📝 텍스트' : '📎 파일'}</Text>
                </View>
                <Text style={styles.ctxTimestamp}>{formatDateTime(ctx.created_at)}</Text>
              </View>
              {ctx.analysis_points.map((point, idx) => (
                <Text key={idx} style={styles.bullet}>
                  • {point}
                </Text>
              ))}
              {ctx.technical_terms && ctx.technical_terms.length > 0 && (
                <Text style={styles.termsText}>용어: {ctx.technical_terms.join(', ')}</Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: 520,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  closeIcon: {
    fontSize: 22,
    color: Brand.textSecondary,
  },
  centerMessage: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: Brand.textDisabled,
  },
  list: {
    marginTop: 16,
  },
  ctxBlock: {
    backgroundColor: Brand.surfaceBackground,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 6,
  },
  ctxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeFile: {
    backgroundColor: '#E8EBFF',
  },
  typeBadgeText: {
    backgroundColor: '#FFF1D6',
  },
  typeBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  ctxTimestamp: {
    fontSize: 11,
    color: Brand.textDisabled,
  },
  bullet: {
    fontSize: 13,
    color: Brand.textPrimary,
    lineHeight: 19,
  },
  termsText: {
    fontSize: 12,
    color: Brand.textSecondary,
    marginTop: 4,
  },
});
