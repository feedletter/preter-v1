import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';
import { consumePendingCreatedProject, fetchProjects, Project } from '@/lib/projects';

type ProjectSelectSheetProps = {
  visible: boolean;
  selectedProjectId: string | null;
  onClose: () => void;
  onApply: (project: Project | null) => void;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd}`;
}

// Create Meeting PRD 4장 (SCR-BS-01~03) — 미팅 생성 폼의 프로젝트 선택 바텀시트.
export function ProjectSelectSheet({
  visible,
  selectedProjectId,
  onClose,
  onApply,
}: ProjectSelectSheetProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(selectedProjectId);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchProjects()
      .then((result) => {
        setProjects(result);
        // create-project 페이지에서 막 생성하고 돌아온 경우 자동 선택.
        const pending = consumePendingCreatedProject();
        setSelectedId(pending ? pending.id : selectedProjectId);
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [visible, selectedProjectId]);

  function handleApply() {
    const project = projects.find((p) => p.id === selectedId) ?? null;
    onApply(project);
    onClose();
  }

  const isEmpty = !loading && projects.length === 0;

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        sheetStyle={isEmpty ? styles.sheetEmpty : styles.sheetFilled}>
        <Text style={styles.title}>프로젝트 선택</Text>
        <Text style={styles.description}>선택한 프로젝트의 지시사항과 자료가 통역에 자동 반영돼요</Text>

        {loading ? (
          <View style={styles.centerMessage}>
            <ActivityIndicator color={Brand.primary} />
          </View>
        ) : isEmpty ? (
          <View style={styles.centerMessage}>
            <Text style={styles.emptyIcon}>🗳️</Text>
            <Text style={styles.emptyTitle}>아직 등록된 프로젝트가 없어요</Text>
            <Text style={styles.emptySubtitle}>프로젝트의 지시사항과 자료가 통역에 반영돼요</Text>
          </View>
        ) : (
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {projects.map((project) => {
              const selected = project.id === selectedId;
              return (
                <Pressable
                  key={project.id}
                  style={[styles.row, selected && styles.rowSelected]}
                  onPress={() => setSelectedId(project.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}>
                  <View style={styles.rowTextCol}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {project.name}
                    </Text>
                    <Text style={styles.rowDate}>{formatDate(project.created_at)}</Text>
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
            onPress={() => {
              onClose();
              router.push('/create-project');
            }}
            accessibilityRole="button">
            <Text style={styles.newButtonLabel}>신규 프로젝트 생성하기</Text>
          </Pressable>

          <Pressable
            style={[styles.applyButton, !selectedId && styles.applyButtonDisabled]}
            onPress={handleApply}
            disabled={!selectedId}
            accessibilityRole="button">
            <Text style={[styles.applyButtonLabel, !selectedId && styles.applyButtonLabelDisabled]}>
              적용하기
            </Text>
          </Pressable>
        </View>
      </BottomSheet>
    </>
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
    maxHeight: 406,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Brand.borderDisabled,
  },
  rowSelected: {
    backgroundColor: '#E8EBFF',
    borderColor: Brand.primary,
  },
  rowTextCol: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Brand.textPrimary,
  },
  rowDate: {
    fontSize: 12,
    color: Brand.textSecondary,
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
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newButtonLabel: {
    fontSize: 16,
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
    fontWeight: '500',
    color: 'white',
  },
  applyButtonLabelDisabled: {
    color: Brand.textDisabled,
  },
});
