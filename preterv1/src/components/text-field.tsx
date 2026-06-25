import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  KeyboardTypeOptions,
  Pressable,
  ReturnKeyTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Brand } from '@/constants/theme';

type TextFieldProps = {
  label: string;
  required?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  error?: string;
  helperText?: string;
  editable?: boolean;
  keyboardType?: KeyboardTypeOptions;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
};

export function TextField({
  label,
  required,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  error,
  helperText,
  editable = true,
  keyboardType,
  returnKeyType,
  onSubmitEditing,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const isActive = focused || value.length > 0;
  const borderColor = error
    ? Brand.error
    : !editable
      ? Brand.borderDisabled
      : isActive
        ? Brand.primary
        : Brand.border;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, error && { color: Brand.error }]}>{label}</Text>
        {required && <View style={styles.requiredDot} />}
      </View>

      <View style={[styles.inputRow, { borderBottomColor: borderColor }]}>
        <TextInput
          style={[styles.input, !editable && { color: Brand.textDisabled }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Brand.textDisabled}
          secureTextEntry={secureTextEntry && !revealed}
          editable={editable}
          autoCapitalize="none"
          keyboardType={keyboardType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => {
            setFocused(true);
            Haptics.selectionAsync();
          }}
          onBlur={() => setFocused(false)}
        />
        {secureTextEntry && value.length > 0 && (
          <Pressable
            onPress={() => setRevealed((prev) => !prev)}
            disabled={!editable}
            hitSlop={8}>
            <Text style={styles.iconButton}>{revealed ? '🙈' : '👁'}</Text>
          </Pressable>
        )}
        {value.length > 0 && editable && (
          <Pressable onPress={() => onChangeText('')} hitSlop={8}>
            <Text style={styles.iconButton}>✕</Text>
          </Pressable>
        )}
      </View>

      {error ? (
        <Text style={styles.helperError}>{error}</Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Brand.textSecondary,
  },
  requiredDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Brand.requiredDot,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    marginTop: 12,
    borderBottomWidth: 1.5,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Brand.textPrimary,
    padding: 0,
  },
  iconButton: {
    fontSize: 18,
    color: Brand.textDisabled,
    padding: 2,
  },
  helperError: {
    fontSize: 13,
    lineHeight: 20,
    color: Brand.error,
    marginTop: 8,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 20,
    color: Brand.textDisabled,
    marginTop: 8,
  },
});
