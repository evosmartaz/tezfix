import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatTime } from '@tezfiks/shared';
import { AppText, Banner, ErrorState, Header, LoadingState, Screen, colors, errorCodeOf, fonts, radii, spacing, useApi, useAuth, useSocketEvent, useT, useToast } from '@tezfiks/mobile';
import { qk, useAssignment } from '../../../data/queries';
import { useAssignmentLive } from '../../../hooks/useAssignmentLive';
import {
  CHAT_MAX_LENGTH,
  addPending,
  canSend,
  confirmPending,
  isMine,
  markFailed,
  markReadLocally,
  mergeMessages,
  newTempId,
  unreadFromOthers,
  unreadIdsFromOthers,
  type ChatItem,
} from '../../../lib/chat';
import { requestErrorInfo } from '../../../lib/requestErrors';
import { contactState, telUrl } from '../../../lib/tracking';

const PAGE = 30;
/** A failed read receipt is sent again after this delay. */
const MARK_READ_RETRY_MS = 5000;

/** Chat with the assigned handyman (socket `chat:message`), allowed from the contact unlock until 2 h after the job ends. */
export default function ChatRoute() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const me = useAuth((s) => s.me);
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAssignment(id);
  const pages = useInfiniteQuery({
    queryKey: qk.chat(id ?? ''),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.call(api.chat.list, { params: { id: id as string }, query: { cursor: pageParam, limit: PAGE } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id,
  });
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState('');
  const marking = useRef(false);
  const [markRetry, setMarkRetry] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  useAssignmentLive(id, () => void q.refetch());

  const fetched = useMemo(() => (pages.data?.pages ?? []).flatMap((p) => p.items), [pages.data]);
  useEffect(() => {
    if (fetched.length) setItems((prev) => mergeMessages(prev, fetched));
  }, [fetched]);

  useSocketEvent('chat:message', (m) => {
    if (m.assignmentId === id) setItems((prev) => mergeMessages(prev, [m]));
  });

  // Everything shown from the handyman counts as read.
  const unread = unreadFromOthers(items, me?.id);
  useEffect(() => {
    if (!id || !unread || marking.current) return;
    // Only what is shown now is confirmed; messages arriving meanwhile stay unread and trigger the next receipt.
    const ids = unreadIdsFromOthers(items, me?.id);
    marking.current = true;
    client
      .call(api.chat.markRead, { params: { id } })
      .then(() => setItems((prev) => markReadLocally(prev, ids, new Date().toISOString())))
      .catch(() => {
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => setMarkRetry((n) => n + 1), MARK_READ_RETRY_MS);
      })
      .finally(() => {
        marking.current = false;
      });
  }, [unread, id, client, me?.id, markRetry]);

  const back = () => (router.canGoBack() ? router.back() : router.replace(`/assignment/${id}` as never));

  if (q.isPending) return <LoadingState testID="chat-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="chat-screen">
        <Header onBack={back} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const a = q.data;
  const contact = contactState(a);

  const deliver = async (tempId: string, body: string) => {
    try {
      const saved = await client.call(api.chat.send, { params: { id: a.id }, body: { body } });
      setItems((prev) => confirmPending(prev, tempId, saved));
    } catch (err) {
      setItems((prev) => markFailed(prev, tempId));
      toast.show(t(errorCodeOf(err) === 'CHAT_LOCKED' ? 'chat.locked' : requestErrorInfo(err).messageKey), { kind: 'error' });
      if (errorCodeOf(err) === 'CHAT_LOCKED') void q.refetch();
    }
  };

  const send = () => {
    if (!canSend(text) || !a.chatEnabled) return;
    const body = text.trim();
    const tempId = newTempId();
    setItems((prev) =>
      addPending(prev, {
        tempId,
        assignmentId: a.id,
        body,
        senderUserId: me?.id ?? '',
        senderName: [me?.firstName, me?.lastName].filter(Boolean).join(' '),
        now: new Date().toISOString(),
      }),
    );
    setText('');
    void deliver(tempId, body);
  };

  const retry = (m: ChatItem) => {
    if (!m.tempId || !m.failed) return;
    setItems((prev) => prev.map((x) => (x.tempId === m.tempId ? { ...x, failed: false, pending: true } : x)));
    void deliver(m.tempId, m.body);
  };

  const name = `${a.provider.firstName} ${a.provider.lastName}`.trim();

  return (
    <Screen edges={['top', 'bottom']} testID="chat-screen">
      <Header
        onBack={back}
        title={name}
        subtitle={t('chat.title')}
        right={
          contact.canCall && a.providerPhone ? (
            <Pressable onPress={() => void Linking.openURL(telUrl(a.providerPhone as string)).catch(() => undefined)} hitSlop={8} testID="chat-call" accessibilityLabel={t('common:actions.call')}>
              <Ionicons name="call-outline" size={22} color={colors.primary} />
            </Pressable>
          ) : undefined
        }
      />
      {!a.chatEnabled ? <Banner tone="info" message={t(contact.locked ? 'chat.locked' : 'chat.closed')} testID="chat-locked" /> : null}
      <FlatList
        data={items}
        inverted
        keyExtractor={(m) => m.tempId ?? m.id}
        renderItem={({ item }) => <Bubble m={item} mine={isMine(item, me?.id)} onRetry={retry} />}
        onEndReached={() => {
          if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
        }}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          pages.isPending ? undefined : (
            <AppText variant="small" color="textMuted" align="center" style={styles.empty} testID="chat-empty">
              {t('chat.empty')}
            </AppText>
          )
        }
        contentContainerStyle={styles.list}
        testID="chat-list"
      />
      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={colors.textMuted}
          editable={a.chatEnabled}
          multiline
          maxLength={CHAT_MAX_LENGTH}
          style={styles.input}
          testID="chat-input"
          accessibilityLabel={t('chat.placeholder')}
        />
        <Pressable
          onPress={send}
          disabled={!a.chatEnabled || !canSend(text)}
          style={[styles.send, !a.chatEnabled || !canSend(text) ? styles.sendOff : null]}
          accessibilityRole="button"
          accessibilityLabel={t('common:actions.send')}
          testID="chat-send"
        >
          <Ionicons name="send" size={18} color={colors.textInverse} />
        </Pressable>
      </View>
    </Screen>
  );
}

function Bubble({ m, mine, onRetry }: { m: ChatItem; mine: boolean; onRetry: (m: ChatItem) => void }) {
  const { t } = useT();
  return (
    <Pressable onPress={() => onRetry(m)} disabled={!m.failed} style={[styles.bubbleRow, mine ? styles.right : styles.left]} testID={`chat-msg-${m.tempId ?? m.id}`}>
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        <AppText variant="body" color={mine ? 'textInverse' : 'text'}>
          {m.body}
        </AppText>
        <AppText variant="caption" color={mine ? 'textInverseMuted' : 'textMuted'} align="right">
          {m.failed ? t('chat.failed') : m.pending ? t('chat.sending') : formatTime(m.createdAt)}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: spacing.sm, flexGrow: 1 },
  empty: { marginVertical: spacing.xl, transform: [{ scaleY: -1 }] },
  bubbleRow: { flexDirection: 'row', marginVertical: spacing.xs },
  left: { justifyContent: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg },
  mine: { backgroundColor: colors.primary, borderBottomRightRadius: radii.sm },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingVertical: spacing.sm, gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: colors.disabled },
});
