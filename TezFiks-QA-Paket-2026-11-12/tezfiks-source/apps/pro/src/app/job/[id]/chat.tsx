import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatTime, type ChatMessage } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  TextField,
  colors,
  errorCodeOf,
  errorMessage,
  radii,
  spacing,
  useApi,
  useAuth,
  useSocketEvent,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { qk } from '../../../hooks/queries';
import { mergeMessages } from '../../../lib/chat';

/** Chat with the customer (open from contact unlock until 2 h after the job ended; CHAT_LOCKED otherwise). */
export default function JobChat() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const myId = useAuth((s) => s.me?.id ?? null);
  const { id: rawId, companyId: rawCompanyId } = useLocalSearchParams<{ id: string; companyId?: string }>();
  const id = typeof rawId === 'string' ? rawId : '';
  const companyId = typeof rawCompanyId === 'string' && rawCompanyId ? rawCompanyId : null;
  // A manager is not the assigned worker: GET /pro/assignments/:id would answer NOT_FOUND, so go back to the company view.
  const jobHref = companyId ? `/company/${companyId}/jobs/${id}` : `/job/${id}`;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState(false);
  const list = useQuery({
    queryKey: qk.chat(id),
    enabled: !!id,
    queryFn: async () => (await client.call(api.chat.list, { params: { id }, query: { limit: 100 } })).items,
  });

  useEffect(() => {
    if (id) void client.call(api.chat.markRead, { params: { id } }).catch(() => undefined);
  }, [id, client, list.data?.length]);

  useSocketEvent('chat:message', (m) => {
    if (m.assignmentId !== id) return;
    queryClient.setQueryData<ChatMessage[]>(qk.chat(id), (cur) => mergeMessages(cur ?? [], m));
  });

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await client.call(api.chat.send, { params: { id }, body: { body } });
      queryClient.setQueryData<ChatMessage[]>(qk.chat(id), (cur) => mergeMessages(cur ?? [], m));
      setText('');
    } catch (err) {
      if (errorCodeOf(err) === 'CHAT_LOCKED') setLocked(true);
      else toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setSending(false);
    }
  };

  const chatLocked = locked || errorCodeOf(list.error) === 'CHAT_LOCKED';
  return (
    <Screen
      testID="chat-screen"
      footer={
        chatLocked ? undefined : (
          <View style={styles.composer}>
            <View style={styles.flex}>
              <TextField value={text} onChangeText={setText} placeholder={t('chat.placeholder')} maxLength={1000} testID="chat-input" />
            </View>
            <Button title={t('chat.send')} onPress={() => void send()} loading={sending} fullWidth={false} style={styles.send} testID="chat-send" />
          </View>
        )
      }
    >
      <Header title={t('chat.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace(jobHref as never))} />
      {chatLocked ? <Banner tone="info" message={t('chat.locked')} testID="chat-locked" /> : null}
      {list.isLoading ? <LoadingState /> : null}
      {list.isError && !chatLocked ? <ErrorState error={list.error} message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <FlatList
          inverted
          data={list.data}
          keyExtractor={(m) => m.id}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={t('chat.empty')} />}
          renderItem={({ item: m }) => {
            const mine = m.senderUserId === myId;
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]} testID={`chat-msg-${m.id}`}>
                <AppText variant="caption" color={mine ? 'textInverse' : 'textMuted'}>
                  {mine ? t('chat.you') : m.senderName}
                </AppText>
                <AppText variant="body" color={mine ? 'textInverse' : 'text'}>
                  {m.body}
                </AppText>
                <AppText variant="caption" color={mine ? 'textInverse' : 'textMuted'} align="right">
                  {formatTime(m.createdAt)}
                </AppText>
              </View>
            );
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-start' },
  send: { marginLeft: spacing.sm, marginTop: 2 },
  bubble: { maxWidth: '80%', borderRadius: radii.lg, padding: spacing.md, marginVertical: spacing.xs },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
