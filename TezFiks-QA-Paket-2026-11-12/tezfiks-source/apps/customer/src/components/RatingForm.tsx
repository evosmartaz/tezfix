import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, Button, Stars, TextField, colors, spacing, useT } from '@tezfiks/mobile';

export const RATING_COMMENT_MAX = 500;

export interface RatingFormProps {
  title: string;
  subtitle?: string | null;
  heading: string;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (rating: { stars: number; comment?: string }) => void;
  testID?: string;
}

/** Board 02 C2 "İş tamamlandı!": 1–5 stars and an optional comment. */
export function RatingForm({ title, subtitle, heading, submitting, error, onSubmit, testID = 'rating-form' }: RatingFormProps) {
  const { t } = useT();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    if (stars < 1) {
      setProblem(t('rate.starsRequired'));
      return;
    }
    setProblem(null);
    const c = comment.trim();
    onSubmit(c ? { stars, comment: c } : { stars });
  };
  return (
    <View testID={testID}>
      <View style={styles.hero}>
        <View style={styles.check}>
          <Ionicons name="checkmark" size={40} color={colors.textInverse} />
        </View>
        <AppText variant="h1" align="center">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" color="textMuted" align="center" testID={`${testID}-subtitle`}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <AppText variant="bodyStrong" align="center" style={styles.heading}>
        {heading}
      </AppText>
      <View style={styles.stars}>
        <Stars value={stars} onChange={(v) => { setStars(v); setProblem(null); }} size={36} testID={`${testID}-stars`} />
      </View>
      <TextField
        placeholder={t('rate.commentPlaceholder')}
        value={comment}
        onChangeText={setComment}
        multiline
        maxLength={RATING_COMMENT_MAX}
        error={problem ?? error ?? null}
        testID={`${testID}-comment`}
      />
      <Button title={t('rate.submit')} onPress={submit} loading={submitting} testID={`${testID}-submit`} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl },
  check: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  heading: { marginBottom: spacing.md },
  stars: { alignItems: 'center', marginBottom: spacing.lg },
});
