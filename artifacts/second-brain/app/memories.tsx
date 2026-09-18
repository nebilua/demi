import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import {
  getConflictingMemoryAliasKeys,
  getConflictingMemoryOwners,
  memoryFingerprint,
} from '@/lib/memory';

export default function MemoriesScreen() {
  const router = useRouter();
  const {
    settings,
    memories,
    storageProtection,
    updateMemory,
    updateMemoryAliases,
    archiveMemory,
    deleteMemory,
    storageError,
  } = useApp();
  const colors = useColors(settings.appearance);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const conflictingAliasKeys = useMemo(
    () => getConflictingMemoryAliasKeys(memories),
    [memories],
  );

  async function runMutation(operation: () => Promise<void>, onSuccess: () => void) {
    if (isMutating) return;
    setIsMutating(true);
    try {
      await operation();
      onSuccess();
    } catch {
      // The shared storage notice below explains that the prior value was kept.
    } finally {
      setIsMutating(false);
    }
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return memories;
    return memories.filter(
      (memory) =>
        memory.content.toLocaleLowerCase().includes(normalized) ||
        (memory.aliases ?? []).some((alias) =>
          alias.toLocaleLowerCase().includes(normalized),
        ) ||
        memory.category.includes(normalized) ||
        memory.source.excerpt.toLocaleLowerCase().includes(normalized),
    );
  }, [memories, query]);

  function beginEdit(id: string, content: string) {
    setEditingId(id);
    setEditingText(content);
  }

  function setAliasDraft(id: string, value: string) {
    setAliasDrafts((current) => ({ ...current, [id]: value }));
  }

  function addAlias(memory: (typeof memories)[number]) {
    const draft = aliasDrafts[memory.id]?.trim();
    if (!draft) return;
    void runMutation(
      () => updateMemoryAliases(memory.id, [...(memory.aliases ?? []), draft]),
      () => setAliasDrafts((current) => ({ ...current, [memory.id]: '' })),
    );
  }

  function removeAlias(memory: (typeof memories)[number], alias: string) {
    void runMutation(
      () =>
        updateMemoryAliases(
          memory.id,
          (memory.aliases ?? []).filter((item) => item !== alias),
        ),
      () => undefined,
    );
  }

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: Platform.OS === 'web' ? 67 : 0,
          paddingBottom: Platform.OS === 'web' ? 34 : 0,
        },
      ]}
    >
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable
          testID="memories-back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.secondary }]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Memory vault
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            {storageProtection === 'encrypted-on-android'
              ? 'encrypted on this device'
              : 'stored locally · preview is not Keystore-encrypted'}
          </Text>
        </View>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.searchWrap}>
        <Feather name="search" size={15} color={colors.mutedForeground} />
        <TextInput
          testID="memory-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Search memories"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
        />
      </View>
      {storageError && (
        <View style={[styles.errorBanner, { backgroundColor: colors.secondary }]}>
          <Feather name="alert-circle" size={14} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>
            {storageError}
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="bookmark" size={25} color={colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {memories.length ? 'No matching memories' : 'Nothing saved yet'}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Demi will propose useful context after relevant conversations. Nothing
              is stored until you approve it.
            </Text>
          </View>
        ) : (
          filtered.map((memory) => (
            <View
              key={memory.id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: memory.archivedAt ? 0.62 : 1,
                },
              ]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.category, { color: colors.primary }]}>
                  {memory.category.toUpperCase()}
                </Text>
                <View style={styles.cardActions}>
                  <Pressable
                    testID={`edit-memory-${memory.id}`}
                    onPress={() => beginEdit(memory.id, memory.content)}
                  >
                    <Feather name="edit-2" size={15} color={colors.mutedForeground} />
                  </Pressable>
                  <Pressable
                    testID={`archive-memory-${memory.id}`}
                    onPress={() =>
                      void runMutation(
                        () => archiveMemory(memory.id, !memory.archivedAt),
                        () => undefined,
                      )
                    }
                    disabled={isMutating}
                  >
                    <Feather
                      name={memory.archivedAt ? 'rotate-ccw' : 'archive'}
                      size={15}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                  <Pressable
                    testID={`delete-memory-${memory.id}`}
                    onPress={() => setDeletingId(memory.id)}
                  >
                    <Feather name="trash-2" size={15} color={colors.destructive} />
                  </Pressable>
                </View>
              </View>
              {editingId === memory.id ? (
                <>
                  <TextInput
                    testID="edit-memory-content"
                    value={editingText}
                    onChangeText={setEditingText}
                    maxLength={240}
                    multiline
                    style={[
                      styles.editInput,
                      {
                        color: colors.cardForeground,
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                      },
                    ]}
                  />
                  <View style={styles.editActions}>
                    <Pressable onPress={() => setEditingId(null)}>
                      <Text style={[styles.actionText, { color: colors.mutedForeground }]}>
                        Cancel
                      </Text>
                    </Pressable>
                    <Pressable
                      testID="save-memory-edit"
                      onPress={() => {
                        void runMutation(
                          () => updateMemory(memory.id, editingText),
                          () => setEditingId(null),
                        );
                      }}
                      disabled={isMutating}
                    >
                      <Text style={[styles.actionText, { color: colors.primary }]}>
                        Save
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={[styles.memoryText, { color: colors.cardForeground }]}>
                  {memory.content}
                </Text>
              )}
              <View style={styles.aliasSection}>
                <Text style={[styles.aliasLabel, { color: colors.mutedForeground }]}>
                  Known as
                </Text>
                {((memory.aliases ?? []).some((alias) =>
                  conflictingAliasKeys.has(memoryFingerprint(alias)) &&
                  getConflictingMemoryOwners(memories, memory.id, alias).length > 0,
                )) && (
                  <View
                    style={[
                      styles.aliasWarning,
                      { backgroundColor: colors.secondary },
                    ]}
                  >
                    <Feather name="alert-circle" size={13} color={colors.destructive} />
                    <Text style={[styles.aliasWarningText, { color: colors.foreground }]}>
                      A name below is shared with another active memory, so Demi will
                      not use it until you remove or change the duplicate.
                    </Text>
                  </View>
                )}
                {(memory.aliases ?? []).map((alias) => {
                  const conflictingOwners = getConflictingMemoryOwners(
                    memories,
                    memory.id,
                    alias,
                  );
                  if (conflictingOwners.length === 0) return null;

                  return (
                    <View key={`conflict-${alias}`} style={styles.aliasConflictGroup}>
                      <Text style={[styles.aliasConflictLabel, { color: colors.mutedForeground }]}>
                        “{alias}” is also used by
                      </Text>
                      <View style={styles.aliasConflictList}>
                        {conflictingOwners.map((owner) => (
                          <Pressable
                            key={owner.id}
                            testID={`conflicting-memory-${memory.id}-${owner.id}`}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit memory ${owner.content}`}
                            onPress={() => beginEdit(owner.id, owner.content)}
                            style={[
                              styles.aliasConflictCard,
                              {
                                backgroundColor: colors.secondary,
                                borderColor: colors.border,
                              },
                            ]}
                          >
                            <View style={styles.aliasConflictCopy}>
                              <Text style={[styles.aliasConflictCategory, { color: colors.primary }]}>
                                {owner.category.toUpperCase()}
                              </Text>
                              <Text
                                numberOfLines={2}
                                style={[styles.aliasConflictText, { color: colors.foreground }]}
                              >
                                {owner.content}
                              </Text>
                            </View>
                            <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  );
                })}
                {(memory.aliases ?? []).length > 0 && (
                  <View style={styles.aliasList}>
                    {(memory.aliases ?? []).map((alias) => (
                      <View
                        key={alias}
                        style={[styles.aliasChip, { backgroundColor: colors.secondary }]}
                      >
                        <Text style={[styles.aliasText, { color: colors.foreground }]}>
                          {alias}
                        </Text>
                        <Pressable
                          testID={`remove-memory-alias-${memory.id}-${alias}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove alias ${alias}`}
                          onPress={() => removeAlias(memory, alias)}
                          disabled={isMutating}
                        >
                          <Feather name="x" size={12} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                <View style={styles.aliasInputRow}>
                  <TextInput
                    testID={`alias-input-${memory.id}`}
                    value={aliasDrafts[memory.id] ?? ''}
                    onChangeText={(value) => setAliasDraft(memory.id, value)}
                    placeholder="Add a name or shorthand"
                    placeholderTextColor={colors.mutedForeground}
                    maxLength={48}
                    style={[
                      styles.aliasInput,
                      {
                        color: colors.cardForeground,
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                      },
                    ]}
                  />
                  <Pressable
                    testID={`add-memory-alias-${memory.id}`}
                    accessibilityRole="button"
                    onPress={() => addAlias(memory)}
                    disabled={isMutating || !(aliasDrafts[memory.id] ?? '').trim()}
                    style={[styles.aliasAddButton, { backgroundColor: colors.secondary }]}
                  >
                    <Text style={[styles.aliasAddText, { color: colors.primary }]}>
                      Add
                    </Text>
                  </Pressable>
                </View>
              </View>
              <Text style={[styles.source, { color: colors.mutedForeground }]}>
                From: “{memory.source.excerpt}”
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      <Modal
        visible={deletingId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeletingId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>
              Delete this memory?
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              This removes it from local storage and future replies. This cannot be
              undone.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                testID="cancel-delete-memory"
                onPress={() => setDeletingId(null)}
              >
                <Text style={[styles.actionText, { color: colors.mutedForeground }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-delete-memory"
                onPress={() => {
                  const id = deletingId;
                  if (id) {
                    void runMutation(
                      () => deleteMemory(id),
                      () => setDeletingId(null),
                    );
                  }
                }}
                disabled={isMutating}
              >
                <Text style={[styles.actionText, { color: colors.destructive }]}>
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, alignItems: 'center', marginHorizontal: 10 },
  headerTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 17 },
  headerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 2 },
  searchWrap: {
    marginHorizontal: 20,
    marginBottom: 12,
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14 },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 10,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  errorText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 10 },
  empty: { alignItems: 'center', paddingHorizontal: 30, paddingTop: 80 },
  emptyTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 18, marginTop: 14 },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 7,
  },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  category: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.1 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  memoryText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  source: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 9,
  },
  aliasSection: { marginTop: 12, gap: 7 },
  aliasLabel: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 10 },
  aliasWarning: {
    padding: 9,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  aliasWarningText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  aliasConflictGroup: { gap: 5 },
  aliasConflictLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 14,
  },
  aliasConflictList: { gap: 6 },
  aliasConflictCard: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aliasConflictCopy: { flex: 1, gap: 2 },
  aliasConflictCategory: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 8,
    letterSpacing: 0.8,
  },
  aliasConflictText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  aliasList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  aliasChip: {
    minHeight: 26,
    borderRadius: 9,
    paddingLeft: 9,
    paddingRight: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  aliasText: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  aliasInputRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  aliasInput: {
    flex: 1,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  aliasAddButton: {
    minHeight: 36,
    borderRadius: 10,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aliasAddText: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 11 },
  editInput: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 11,
    padding: 9,
    marginTop: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 20,
    marginTop: 9,
  },
  actionText: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 12, padding: 6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: 18, padding: 18 },
  modalTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 18 },
  modalBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 18 },
});