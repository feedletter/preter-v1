import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';
import { createDocument, Document, fetchDocuments } from '@/lib/documents';
import { applyProjectDocument } from '@/lib/projects';

type ProjectDocSheetProps = {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  onApplied: () => void;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd}`;
}

// Project Detail PRD 5장 (SCR-PD-03/04/05) — 자료 추가 하프 바텀시트.
export function ProjectDocSheet({ visible, projectId, onClose, onApplied }: ProjectDocSheetProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setSelectedId(null);
    fetchDocuments()
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [visible]);

  async function handleApply() {
    if (!selectedId || applying) return;
    setApplying(true);
    try {
      await applyProjectDocument(projectId, selectedId);
      onClose();
      // onApplied()는 project-detail 화면 전체를 다시 불러오는 무거운 refetch라,
      // 닫힘 애니메이션(최대 280ms) 도중에 같이 발사되면 응답이 도착하는 시점에
      // 화면 전체가 리렌더되며 애니메이션과 겹쳐 버벅인다. 애니메이션이 끝난
      // 뒤에 시작하도록 지연시킨다.
      setTimeout(onApplied, 280);
    } catch {
      Alert.alert(t('projectDocSheet.applyFailed'));
    } finally {
      setApplying(false);
    }
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
    <>
      <BottomSheet visible={visible} onClose={onClose} sheetStyle={isEmpty ? styles.sheetEmpty : styles.sheetFilled}>
        <Text style={styles.title}>{t('projectDocSheet.title')}</Text>
        <Text style={styles.description}>{t('projectDocSheet.description')}</Text>

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
                  style={[styles.docRow, selected && styles.docRowSelected]}
                  onPress={() => setSelectedId(doc.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}>
                  <View style={styles.docIconBox}>
                    <Text style={styles.docIcon}>📄</Text>
                  </View>
                  <View style={styles.docTextCol}>
                    <Text style={styles.docTitle} numberOfLines={1}>
                      {doc.title}
                    </Text>
                    <Text style={styles.docDate}>{formatDate(doc.created_at)}</Text>
                  </View>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <Pressable
          style={styles.newDocButton}
          onPress={handleCreateDocument}
          disabled={creating}
          accessibilityRole="button">
          {creating ? (
            <ActivityIndicator color={Brand.primary} size="small" />
          ) : (
            <Text style={styles.newDocButtonLabel}>{t('documentSelectSheet.newDocumentButton')}</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.applyButton, !selectedId && styles.applyButtonDisabled]}
          onPress={handleApply}
          disabled={!selectedId || applying}
          accessibilityRole="button">
          {applying ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={[styles.applyButtonLabel, !selectedId && styles.applyButtonLabelDisabled]}>{t('documentSelectSheet.applyButton')}</Text>
          )}
        </Pressable>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  sheetFilled: {
    minHeight: 609,
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
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginBottom: 8,
  },
  docRowSelected: {
    backgroundColor: '#E8EBFF',
  },
  docIconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: Brand.surfaceBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docIcon: {
    fontSize: 20,
  },
  docTextCol: {
    flex: 1,
    gap: 4,
  },
  docTitle: {
    fontSize: 14,
    color: Brand.textPrimary,
  },
  docDate: {
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
  newDocButton: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  newDocButtonLabel: {
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
    marginTop: 12,
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
