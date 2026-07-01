import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';
import { createDocument, Document, fetchDocuments } from '@/lib/documents';

type DocumentSelectSheetProps = {
  visible: boolean;
  selectedDocumentId: string | null;
  onClose: () => void;
  onApply: (document: Document | null) => void;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd}`;
}

// Create Meeting PRD 5장 (SCR-BS-04~06) — 미팅 생성 폼의 자료 선택 바텀시트.
export function DocumentSelectSheet({
  visible,
  selectedDocumentId,
  onClose,
  onApply,
}: DocumentSelectSheetProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(selectedDocumentId);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSelectedId(selectedDocumentId);
    setLoading(true);
    fetchDocuments()
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [visible, selectedDocumentId]);

  function handleApply() {
    const document = documents.find((d) => d.id === selectedId) ?? null;
    onApply(document);
    onClose();
  }

  async function handleCreateDocument() {
    if (creating) return;
    setCreating(true);
    try {
      const document = await createDocument();
      onClose();
      router.push({ pathname: '/doc-detail', params: { document_id: document.id } });
    } catch {
      Alert.alert(t('documentSelectSheet.createFailed'));
    } finally {
      setCreating(false);
    }
  }

  const isEmpty = !loading && documents.length === 0;

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={isEmpty ? styles.sheetEmpty : styles.sheetFilled}>
      <Text style={styles.title}>{t('documentSelectSheet.title')}</Text>
      <Text style={styles.description}>{t('documentSelectSheet.description')}</Text>

      {loading ? (
        <View style={styles.centerMessage}>
          <ActivityIndicator color={Brand.primary} />
        </View>
      ) : isEmpty ? (
        <View style={styles.centerMessage}>
          <Text style={styles.emptyIcon}>📄</Text>
          <Text style={styles.emptyTitle}>{t('documentSelectSheet.emptyTitle')}</Text>
          <Text style={styles.emptySubtitle}>{t('documentSelectSheet.emptySubtitle')}</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {documents.map((doc) => {
            const selected = doc.id === selectedId;
            return (
              <Pressable
                key={doc.id}
                style={[styles.row, selected && styles.rowSelected]}
                onPress={() => setSelectedId(doc.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}>
                <View style={styles.iconBox}>
                  <Text style={styles.icon}>📄</Text>
                </View>
                <View style={styles.rowTextCol}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {doc.title}
                  </Text>
                  <Text style={styles.rowDate}>{formatDate(doc.created_at)}</Text>
                </View>
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected && <View style={styles.radioDot} />}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.buttonGroup}>
        <Pressable
          style={styles.newButton}
          onPress={handleCreateDocument}
          disabled={creating}
          accessibilityRole="button">
          {creating ? (
            <ActivityIndicator color={Brand.primary} size="small" />
          ) : (
            <Text style={styles.newButtonLabel}>{t('documentSelectSheet.newDocumentButton')}</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.applyButton, !selectedId && styles.applyButtonDisabled]}
          onPress={handleApply}
          disabled={!selectedId}
          accessibilityRole="button">
          <Text style={[styles.applyButtonLabel, !selectedId && styles.applyButtonLabelDisabled]}>{t('documentSelectSheet.applyButton')}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetFilled: {
    minHeight: 689,
  },
  sheetEmpty: {
    minHeight: 443,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
    marginTop: 8,
  },
  description: {
    fontSize: 13,
    color: Brand.textSecondary,
    marginTop: 6,
  },
  centerMessage: {
    flex: 1,
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Brand.textPrimary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Brand.textDisabled,
  },
  list: {
    marginTop: 16,
    maxHeight: 380,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginBottom: 8,
  },
  rowSelected: {
    backgroundColor: '#E8EBFF',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: Brand.surfaceBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
  },
  rowTextCol: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: 14,
    color: Brand.textPrimary,
  },
  rowDate: {
    fontSize: 12,
    color: Brand.textDisabled,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Brand.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: Brand.primary,
  },
  radioDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: Brand.primary,
  },
  buttonGroup: {
    gap: 8,
    marginTop: 16,
  },
  newButton: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Brand.primary,
  },
  applyButton: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonDisabled: {
    backgroundColor: Brand.borderDisabled,
  },
  applyButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: 'white',
  },
  applyButtonLabelDisabled: {
    color: Brand.textDisabled,
  },
});
