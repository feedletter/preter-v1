import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { DeleteProjectModal } from '@/components/delete-project-modal';
import { ProjectDocSheet } from '@/components/project-doc-sheet';
import { ProjectInstructionsSheet } from '@/components/project-instructions-sheet';
import { RenameProjectModal } from '@/components/rename-project-modal';
import { Brand } from '@/constants/theme';
import {
  deleteProject,
  fetchProjectDetail,
  fetchProjectMeetings,
  ProjectDetail,
  ProjectMeeting,
  updateProjectName,
} from '@/lib/projects';
import i18n from '@/lib/i18n';

function formatDetail(meeting: ProjectMeeting): string {
  if (!meeting.started_at) return '';
  const d = new Date(meeting.started_at);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const parts = [`${d.getFullYear()}.${mm}.${dd}`];
  if (meeting.duration_min != null) parts.push(`${meeting.duration_min}m`);
  if (meeting.project_name) parts.push(meeting.project_name);
  return parts.join(' · ');
}

// Project Detail PRD 9.1 — 자료/지침 등록 여부에 따른 탭 레이블 동적 변환.
function tabLabels(detail: ProjectDetail | null) {
  const hasDocs = (detail?.document_count ?? 0) > 0;
  const hasInstructions = detail?.has_instructions ?? false;
  return {
    left: hasDocs ? i18n.t('projectDetail.tabDocs') : i18n.t('projectDetail.tabAddDocs'),
    right: hasInstructions ? i18n.t('projectDetail.tabInstructions') : i18n.t('projectDetail.tabAddInstructions'),
  };
}

export default function ProjectDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { project_id } = useLocalSearchParams<{ project_id: string }>();

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [meetings, setMeetings] = useState<ProjectMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [menuVisible, setMenuVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [docSheetVisible, setDocSheetVisible] = useState(false);
  const [instructionsVisible, setInstructionsVisible] = useState(false);

  const load = useCallback(async () => {
    if (!project_id) return;
    try {
      const [detailResult, meetingsResult] = await Promise.all([
        fetchProjectDetail(project_id),
        fetchProjectMeetings(project_id),
      ]);
      setDetail(detailResult);
      setMeetings(meetingsResult);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [project_id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleRename(name: string) {
    if (!project_id) return;
    try {
      await updateProjectName(project_id, name);
      setDetail((prev) => (prev ? { ...prev, name } : prev));
      setRenameVisible(false);
      Alert.alert(t('projectDetail.renamed'));
    } catch {
      Alert.alert(t('projectDetail.renameFailed'));
    }
  }

  async function handleDelete() {
    if (!project_id) return;
    try {
      await deleteProject(project_id);
      setDeleteVisible(false);
      router.back();
    } catch {
      Alert.alert(t('projectDetail.deleteFailed'));
    }
  }

  const labels = tabLabels(detail);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel={t('projectDetail.back')} accessibilityRole="button">
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {detail?.name ?? ''}
        </Text>
        <Pressable
          onPress={() => setMenuVisible((v) => !v)}
          hitSlop={8}
          accessibilityLabel={t('projectDetail.optionsMenu')}
          accessibilityRole="button">
          <Text style={styles.moreIcon}>⋯</Text>
        </Pressable>
      </View>

      {menuVisible && (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
          <View style={styles.menu}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setRenameVisible(true);
              }}>
              <Text style={styles.menuItemLabel}>{t('projectDetail.renameMenu')}</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setDeleteVisible(true);
              }}>
              <Text style={[styles.menuItemLabel, styles.menuItemDanger]}>{t('projectDetail.deleteMenu')}</Text>
            </Pressable>
          </View>
        </>
      )}

      <View style={styles.tabRow}>
        <Pressable
          style={styles.tabButton}
          onPress={() => setDocSheetVisible(true)}
          accessibilityRole="button"
          accessibilityState={{ selected: false }}>
          <Text style={styles.tabButtonLabel}>{labels.left}</Text>
        </Pressable>
        <Pressable
          style={styles.tabButton}
          onPress={() => setInstructionsVisible(true)}
          accessibilityRole="button"
          accessibilityState={{ selected: false }}>
          <Text style={styles.tabButtonLabel}>{labels.right}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.centerMessage}>
            <ActivityIndicator color={Brand.primary} />
          </View>
        ) : loadError ? (
          <View style={styles.centerMessage}>
            <Text style={styles.errorText}>{t('projectDetail.loadFailed')}</Text>
            <Pressable onPress={load} style={styles.retryButton}>
              <Text style={styles.retryButtonLabel}>{t('projectDetail.retry')}</Text>
            </Pressable>
          </View>
        ) : meetings.length === 0 ? (
          <View style={styles.centerMessage}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>{t('projectDetail.noMeetings')}</Text>
          </View>
        ) : (
          meetings.map((meeting) => (
            <Pressable
              key={meeting.id}
              style={styles.meetingRow}
              onPress={() => router.push({ pathname: '/after-meeting', params: { room_id: meeting.id } })}
              accessibilityRole="button">
              <View style={styles.meetingTextCol}>
                <Text style={styles.meetingTitle} numberOfLines={1}>
                  {meeting.title ?? t('main.noTitleMeeting')}
                </Text>
                <Text style={styles.meetingDetail}>{formatDetail(meeting)}</Text>
              </View>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      <RenameProjectModal
        visible={renameVisible}
        currentName={detail?.name ?? ''}
        onClose={() => setRenameVisible(false)}
        onConfirm={handleRename}
      />

      <DeleteProjectModal visible={deleteVisible} onClose={() => setDeleteVisible(false)} onConfirm={handleDelete} />

      {project_id && (
        <>
          <ProjectDocSheet
            visible={docSheetVisible}
            projectId={project_id}
            onClose={() => setDocSheetVisible(false)}
            onApplied={load}
          />
          <ProjectInstructionsSheet
            visible={instructionsVisible}
            projectId={project_id}
            currentContent={detail?.instruction_content ?? null}
            onClose={() => setInstructionsVisible(false)}
            onSaved={(content) =>
              setDetail((prev) => (prev ? { ...prev, instruction_content: content, has_instructions: !!content } : prev))
            }
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  backIcon: {
    fontSize: 26,
    color: Brand.textPrimary,
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  moreIcon: {
    fontSize: 20,
    color: Brand.textPrimary,
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  menu: {
    position: 'absolute',
    top: 52,
    right: 16,
    zIndex: 11,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 140,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  menuItemLabel: {
    fontSize: 14,
    color: Brand.textPrimary,
  },
  menuItemDanger: {
    color: Brand.error,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Brand.borderDisabled,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  tabButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Brand.borderDisabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  centerMessage: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 24,
  },
  emptyText: {
    fontSize: 14,
    color: Brand.textDisabled,
  },
  errorText: {
    fontSize: 14,
    color: Brand.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Brand.surfaceBackground,
  },
  retryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Brand.primary,
  },
  meetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    gap: 8,
  },
  meetingTextCol: {
    flex: 1,
    gap: 4,
  },
  meetingTitle: {
    fontSize: 14,
    color: Brand.textPrimary,
  },
  meetingDetail: {
    fontSize: 12,
    color: Brand.textDisabled,
  },
  arrowIcon: {
    fontSize: 16,
    color: Brand.textDisabled,
  },
});
