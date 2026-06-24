import { createRef, useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Brand } from '@/constants/theme';

const LENGTH = 6;

type CodeInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  editable?: boolean;
  hasError?: boolean;
};

export function CodeInput({ value, onChangeText, editable = true, hasError }: CodeInputProps) {
  const refs = useRef(Array.from({ length: LENGTH }, () => createRef<TextInput>()));

  function handleChangeDigit(index: number, digit: string) {
    const sanitized = digit.replace(/[^0-9]/g, '');
    const chars = value.split('');

    if (sanitized.length === 0) {
      chars[index] = '';
      onChangeText(chars.join('').slice(0, LENGTH));
      return;
    }

    // 붙여넣기 등으로 여러 자리가 한 번에 들어오는 경우 그대로 채운다.
    if (sanitized.length > 1) {
      onChangeText(sanitized.slice(0, LENGTH));
      const lastIndex = Math.min(index + sanitized.length, LENGTH) - 1;
      refs.current[lastIndex]?.current?.focus();
      return;
    }

    chars[index] = sanitized;
    const next = chars.join('').slice(0, LENGTH);
    onChangeText(next);

    if (index < LENGTH - 1) {
      refs.current[index + 1]?.current?.focus();
    }
  }

  function handleKeyPress(index: number, key: string) {
    if (key === 'Backspace' && !value[index] && index > 0) {
      refs.current[index - 1]?.current?.focus();
    }
  }

  return (
    <View style={styles.row}>
      {Array.from({ length: LENGTH }, (_, index) => (
        <TextInput
          key={index}
          ref={refs.current[index]}
          style={[
            styles.box,
            { borderColor: hasError ? Brand.error : value[index] ? Brand.primary : Brand.border },
            !editable && { borderColor: Brand.borderDisabled },
          ]}
          value={value[index] ?? ''}
          onChangeText={(text) => handleChangeDigit(index, text)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
          keyboardType="number-pad"
          maxLength={index === 0 ? LENGTH : 1}
          editable={editable}
          textAlign="center"
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  box: {
    flex: 1,
    height: 56,
    borderWidth: 1.5,
    borderRadius: 8,
    fontSize: 22,
    fontWeight: '600',
    color: Brand.textPrimary,
  },
});
