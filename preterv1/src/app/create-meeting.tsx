import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguageSelect, GuestLanguage } from '@/components/language-select';
import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { createRoom, RoomsApiError } from '@/lib/rooms';

// Main PRD 6.2 "Member Create MeetingRoom" — Host로서 새 미팅룸을 만들고 코드를 발급받는 화면.
export default function CreateMeetingScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<GuestLanguage>('ko');
  const [creating, setCreating] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const result = await createRoom({
        title: title.trim() || undefined,
        password: password || undefined,
        primary_language: language,
      });
      setCreatedCode(result.room_code);
    } catch (err) {
      if (err instanceof RoomsApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert('네트워크 연결을 확인해주세요');
      } else {
        Alert.alert('미팅룸 생성에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>미팅룸 생성</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {createdCode ? (
            <View style={styles.successWrap}>
              <Text style={styles.successTitle}>미팅룸이 생성됐어요</Text>
              <Text style={styles.successSubtitle}>참가자에게 아래 코드를 전달해주세요</Text>
              <Text style={styles.codeText}>{createdCode}</Text>
              <Pressable style={styles.primaryButton} onPress={() => router.replace('/main')}>
                <Text style={styles.primaryButtonLabel}>홈으로 돌아가기</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.headerTitle}>미팅룸 정보 입력</Text>
              <Text style={styles.headerSubtitle}>제목과 옵션을 설정하고 미팅룸을 생성해요</Text>

              <View style={styles.fields}>
                <TextField
                  label="미팅 제목 (선택)"
                  value={title}
                  onChangeText={setTitle}
                  placeholder="예: TFP 첫 결제 확정 미팅"
                  editable={!creating}
                />

                <LanguageSelect value={language} onChange={setLanguage} disabled={creating} />

                <TextField
                  label="미팅룸 비밀번호 (선택)"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="설정하지 않으면 코드만으로 참가할 수 있어요"
                  secureTextEntry
                  editable={!creating}
                />
              </View>

              <Pressable onPress={handleCreate} disabled={creating} style={styles.primaryButton}>
                {creating ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.primaryButtonLabel}>미팅룸 생성하기</Text>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    left: 20,
    top: 16,
  },
  backIcon: {
    fontSize: 28,
    color: Brand.textPrimary,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Brand.textSecondary,
    marginTop: 4,
  },
  fields: {
    marginTop: 24,
    gap: 24,
  },
  primaryButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },
  primaryButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
  successWrap: {
    alignItems: 'center',
    paddingTop: Spacing.six,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  successSubtitle: {
    fontSize: 14,
    color: Brand.textSecondary,
    marginTop: 8,
  },
  codeText: {
    fontSize: 36,
    fontWeight: '700',
    color: Brand.primary,
    marginTop: 24,
    letterSpacing: 4,
  },
});
