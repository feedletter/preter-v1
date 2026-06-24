import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateProjectSheet } from '@/components/create-project-sheet';
import { UploadDocumentSheet } from '@/components/upload-document-sheet';
import { Brand } from '@/constants/theme';
import { Document, DocumentsApiError, fetchDocuments } from '@/lib/documents';
import { fetchRecentMeetings, MeetingsApiError, RecentMeeting } from '@/lib/meetings';
import { fetchProjects, Project, ProjectsApiError } from '@/lib/projects';

// Figma LeftSide PRD 2장: 패널은 풀스크린(디바이스 전체 너비)로 슬라이드 — 사이드바처럼
// 일부 영역만 차지하면 안 됨.
const PANEL_WIDTH = Dimensions.get('window').width;

type Tab = 'meeting' | 'document';

type LeftSidePanelProps = {
  visible: boolean;
  onClose: () => void;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd}`;
}

// LeftSide PRD 4.3 — 미팅 날짜 + 진행 시간 + 프로젝트명 조합 규칙.
function formatMeetingDetail(meeting: RecentMeeting): string {
  if (!meeting.started_at) return '';
  const parts = [formatDate(meeting.started_at)];
  if (meeting.duration_min != null) parts.push(`${meeting.duration_min}m`);
  if (meeting.project_name) parts.push(meeting.project_name);
  return parts.join(' · ');
}

// LeftSide PRD P2 — 검색 키워드 매칭 텍스트에 primary 색상 강조.
function HighlightedText({ text, keyword, style }: { text: string; keyword: string; style: object }) {
  if (!keyword) return <Text style={style} numberOfLines={1}>{text}</Text>;

  const lower = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = lower.indexOf(lowerKeyword, cursor);
    if (index === -1) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + keyword.length), match: true });
    cursor = index + keyword.length;
  }

  return (
    <Text style={style} numberOfLines={1}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.match ? <Text style={{ color: Brand.primary, fontWeight: '700' }}>{part.text}</Text> : part.text}
        </Fragment>
      ))}
    </Text>
  );
}

export function LeftSidePanel({ visible, onClose }: LeftSidePanelProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const dimOpacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(-PANEL_WIDTH)).current;

  const [tab, setTab] = useState<Tab>('meeting');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [meetings, setMeetings] = useState<RecentMeeting[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [createProjectVisible, setCreateProjectVisible] = useState(false);
  const [uploadDocumentVisible, setUploadDocumentVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      // dim은 패널과 별개로 순수 fade만 — spring의 overshoot/잔동이 dim의 고정 길이
      // fade와 타이밍이 어긋나며 버벅이는 느낌을 줬다. 둘 다 같은 duration/easing의
      // timing으로 맞춰 동시에 끝나도록 통일.
      Animated.parallel([
        Animated.timing(dimOpacity, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(dimOpacity, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: -PANEL_WIDTH,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const load = useCallback(async () => {
    try {
      const [projectsResult, meetingsResult, documentsResult] = await Promise.all([
        fetchProjects(),
        fetchRecentMeetings(),
        fetchDocuments(),
      ]);
      setProjects(projectsResult);
      setMeetings(meetingsResult);
      setDocuments(documentsResult);
      setLoadError(false);
    } catch (error) {
      if (error instanceof ProjectsApiError || error instanceof MeetingsApiError || error instanceof DocumentsApiError) {
        setLoadError(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [visible, load]);

  // LeftSide PRD P3 — Pull to Refresh (양 탭 공통 데이터 소스라 동시에 새로고침).
  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => {
    setQuery('');
    setDebouncedQuery('');
  }, [tab]);

  // LeftSide PRD 5.5 — 검색 debounce 300ms.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const filteredProjects = useMemo(() => {
    if (!debouncedQuery) return projects;
    const keyword = debouncedQuery.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(keyword));
  }, [projects, debouncedQuery]);

  const filteredMeetings = useMemo(() => {
    if (!debouncedQuery) return meetings;
    const keyword = debouncedQuery.toLowerCase();
    return meetings.filter((m) => (m.title ?? '').toLowerCase().includes(keyword));
  }, [meetings, debouncedQuery]);

  const filteredDocuments = useMemo(() => {
    if (!debouncedQuery) return documents;
    const keyword = debouncedQuery.toLowerCase();
    return documents.filter((d) => d.title.toLowerCase().includes(keyword));
  }, [documents, debouncedQuery]);

  const meetingTabEmpty = projects.length === 0 && meetings.length === 0;
  const meetingTabNoSearchResults =
    !meetingTabEmpty && debouncedQuery.length > 0 && filteredProjects.length === 0 && filteredMeetings.length === 0;

  const documentTabEmpty = documents.length === 0;
  const documentTabNoSearchResults =
    !documentTabEmpty && debouncedQuery.length > 0 && filteredDocuments.length === 0;

  function handlePressProject(project: Project) {
    onClose();
    router.push({ pathname: '/project-detail', params: { project_id: project.id } });
  }

  function handlePressMeeting(meeting: RecentMeeting) {
    Alert.alert('미팅 상세 화면은 준비 중이에요');
  }

  function handlePressDocument(doc: Document) {
    Alert.alert('자료 보기 화면은 준비 중이에요');
  }

  function handlePressNewDocument() {
    setUploadDocumentVisible(true);
  }

  function handleClose() {
    setQuery('');
    onClose();
  }

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.dim, { opacity: dimOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            { width: PANEL_WIDTH, paddingTop: insets.top, transform: [{ translateX }] },
          ]}>
          <View style={styles.header}>
            <Image
              source={require('@/assets/images/brand/preter-logo-primary.png')}
              style={styles.logo}
              contentFit="contain"
            />
            <Pressable
              hitSlop={8}
              onPress={handleClose}
              accessibilityLabel="이전 화면으로 돌아가기"
              accessibilityRole="button"
              style={styles.backButton}>
              <Text style={styles.backIcon}>‹</Text>
            </Pressable>
          </View>

          <View style={styles.tabBar}>
            <Pressable
              style={[styles.tabItem, tab !== 'meeting' && styles.tabItemUnselectedBorder]}
              onPress={() => setTab('meeting')}
              accessibilityRole="button">
              <Text style={[styles.tabLabel, tab === 'meeting' && styles.tabLabelActive]}>미팅</Text>
              {tab === 'meeting' && <View style={styles.tabIndicator} />}
            </Pressable>
            <Pressable
              style={[styles.tabItem, tab !== 'document' && styles.tabItemUnselectedBorder]}
              onPress={() => setTab('document')}
              accessibilityRole="button">
              <Text style={[styles.tabLabel, tab === 'document' && styles.tabLabelActive]}>미팅 자료</Text>
              {tab === 'document' && <View style={styles.tabIndicator} />}
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Brand.primary} />
            }>
            {loading ? (
              <View style={styles.centerMessage}>
                <ActivityIndicator color={Brand.primary} />
              </View>
            ) : loadError ? (
              <View style={styles.centerMessage}>
                <Text style={styles.errorText}>목록을 불러오지 못했어요</Text>
                <Pressable onPress={load} style={styles.retryButton}>
                  <Text style={styles.retryButtonLabel}>다시 시도</Text>
                </Pressable>
              </View>
            ) : tab === 'meeting' ? (
              meetingTabEmpty ? (
                <View style={styles.centerMessage}>
                  <Text style={styles.emptyIcon}>📋</Text>
                  <Text style={styles.emptyText}>진행한 미팅이 없어요</Text>
                </View>
              ) : meetingTabNoSearchResults ? (
                <View style={styles.centerMessage}>
                  <Text style={styles.emptyText}>검색 결과가 없어요</Text>
                </View>
              ) : (
                <View>
                  {filteredProjects.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>프로젝트</Text>
                      {filteredProjects.map((project) => (
                        <Pressable
                          key={project.id}
                          style={styles.projectRow}
                          onPress={() => handlePressProject(project)}
                          accessibilityRole="button">
                          <View style={styles.rowTextCol}>
                            <HighlightedText text={project.name} keyword={debouncedQuery} style={styles.rowTitle} />
                            <Text style={styles.rowDetail}>{formatDate(project.created_at)}</Text>
                          </View>
                          <Text style={styles.arrowIcon}>›</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {filteredMeetings.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>최근 미팅</Text>
                      {filteredMeetings.map((meeting) => (
                        <Pressable
                          key={meeting.id}
                          style={styles.meetingRow}
                          onPress={() => handlePressMeeting(meeting)}
                          accessibilityRole="button">
                          <View style={styles.rowTextCol}>
                            <HighlightedText
                              text={meeting.title ?? '제목 없는 미팅'}
                              keyword={debouncedQuery}
                              style={styles.rowTitle}
                            />
                            <Text style={styles.rowDetail}>{formatMeetingDetail(meeting)}</Text>
                          </View>
                          <Text style={styles.arrowIcon}>›</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              )
            ) : documentTabEmpty ? (
              <View style={styles.centerMessage}>
                <Text style={styles.emptyIcon}>📁</Text>
                <Text style={styles.emptyText}>저장된 자료가 없어요</Text>
              </View>
            ) : documentTabNoSearchResults ? (
              <View style={styles.centerMessage}>
                <Text style={styles.emptyText}>검색 결과가 없어요</Text>
              </View>
            ) : (
              <View>
                {filteredDocuments.map((doc) => (
                  <Pressable
                    key={doc.id}
                    style={styles.documentRow}
                    onPress={() => handlePressDocument(doc)}
                    accessibilityRole="button">
                    <View style={styles.rowTextCol}>
                      <HighlightedText text={doc.title} keyword={debouncedQuery} style={styles.rowTitle} />
                      <Text style={styles.rowDetail}>{formatDate(doc.created_at)}</Text>
                    </View>
                    <Text style={styles.arrowIcon}>›</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={styles.floatingButtonRow}>
            {tab === 'meeting' ? (
              <Pressable
                style={styles.floatingButton}
                onPress={() => setCreateProjectVisible(true)}
                accessibilityRole="button">
                <Text style={styles.floatingButtonLabel}>새 프로젝트</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.floatingButton} onPress={handlePressNewDocument} accessibilityRole="button">
                <Text style={styles.floatingButtonLabel}>새 미팅 자료</Text>
              </Pressable>
            )}
          </View>

          <View style={[styles.searchBar, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.searchInputWrap}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={tab === 'meeting' ? '검색' : '자료 검색'}
                placeholderTextColor={Brand.textDisabled}
                style={styles.searchInput}
              />
            </View>
          </View>
        </Animated.View>
      </View>

      <CreateProjectSheet
        visible={createProjectVisible}
        onClose={() => setCreateProjectVisible(false)}
        onCreated={(project) => setProjects((prev) => [project, ...prev])}
      />

      <UploadDocumentSheet
        visible={uploadDocumentVisible}
        onClose={() => setUploadDocumentVisible(false)}
        onUploaded={(document) => setDocuments((prev) => [document, ...prev])}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  panel: {
    height: '100%',
    backgroundColor: 'white',
  },
  header: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    width: 91,
    height: 22,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 26,
    color: Brand.textPrimary,
  },
  tabBar: {
    height: 48,
    flexDirection: 'row',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 14,
    gap: 10,
  },
  tabItemUnselectedBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Brand.borderDisabled,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.textDisabled,
    lineHeight: 22,
  },
  tabLabelActive: {
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  tabIndicator: {
    height: 2,
    width: '100%',
    backgroundColor: Brand.textPrimary,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    flexGrow: 1,
  },
  centerMessage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 300,
  },
  emptyIcon: {
    fontSize: 24,
  },
  emptyText: {
    fontSize: 14,
    color: Brand.textDisabled,
    textAlign: 'center',
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
  section: {
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    color: Brand.textDisabled,
    marginBottom: 4,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    gap: 8,
  },
  meetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    gap: 8,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingLeft: 0,
    gap: 8,
  },
  rowTextCol: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: 14,
    color: Brand.textPrimary,
  },
  rowDetail: {
    fontSize: 12,
    color: Brand.textDisabled,
  },
  arrowIcon: {
    fontSize: 16,
    color: Brand.textDisabled,
  },
  floatingButtonRow: {
    paddingHorizontal: 20,
    alignItems: 'flex-end',
  },
  floatingButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#EFEFEF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  floatingButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  searchBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  searchInputWrap: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Brand.surfaceBackground,
  },
  searchIcon: {
    fontSize: 14,
    color: Brand.textDisabled,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Brand.textPrimary,
  },
});
