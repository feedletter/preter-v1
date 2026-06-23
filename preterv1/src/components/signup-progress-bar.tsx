import { StyleSheet, Text, View } from 'react-native';

import { Brand } from '@/constants/theme';

export function SignupProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${(step / total) * 100}%` }]} />
      </View>
      <Text style={styles.label}>
        {step} / {total}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  track: {
    height: 3,
    width: '100%',
    backgroundColor: Brand.borderDisabled,
  },
  fill: {
    height: 3,
    backgroundColor: Brand.primary,
  },
  label: {
    fontSize: 12,
    color: Brand.textSecondary,
    marginTop: 9,
  },
});
