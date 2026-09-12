import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

type PersonalProfileEditorProps = {
  visible: boolean;
  mode: 'onboarding' | 'settings';
  onClose?: () => void;
};

export function PersonalProfileEditor({
  visible,
  mode,
  onClose,
}: PersonalProfileEditorProps) {
  const {
    settings,
    profile,
    saveProfile,
    skipProfile,
    clearProfile,
  } = useApp();
  const colors = useColors(settings.appearance);
  const [displayName, setDisplayName] = useState('');
  const [context, setContext] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isOnboarding = mode === 'onboarding';
  const hasProfile = Boolean(profile.displayName || profile.context);

  useEffect(() => {
    if (!visible) return;
    setDisplayName(profile.displayName);
    setContext(profile.context);
  }, [visible, profile.displayName, profile.context]);

  async function handleSave() {
    setIsSaving(true);
    await saveProfile({ displayName, context });
    setIsSaving(false);
    onClose?.();
  }

  async function handleSkip() {
    setIsSaving(true);
    await skipProfile();
    setIsSaving(false);
    onClose?.();
  }

  async function handleClear() {
    setIsSaving(true);
    await clearProfile();
    setDisplayName('');
    setContext('');
    setIsSaving(false);
    onClose?.();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={isOnboarding ? undefined : onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.background }]}>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={styles.scrollContent}
          bottomOffset={24}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.headingRow}>
              <View style={[styles.icon, { backgroundColor: colors.accent }]}>
                <Feather name="user" size={20} color={colors.primary} />
              </View>
              {!isOnboarding && onClose && (
                <Pressable
                  testID="close-profile-editor"
                  accessibilityRole="button"
                  accessibilityLabel="Close profile editor"
                  onPress={onClose}
                  hitSlop={10}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Feather name="x" size={20} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              {isOnboarding ? 'OPTIONAL · ON THIS DEVICE' : 'LOCAL PROFILE'}
            </Text>
            <Text style={[styles.title, { color: colors.cardForeground }]}>
              {isOnboarding
                ? 'A little context, on your terms.'
                : 'Shape your local replies.'}
            </Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              {isOnboarding
                ? 'Tell Demi what would make its help more useful. You can skip this and change it anytime.'
                : 'Review or update the private context used by the offline model.'}
            </Text>

            <View style={[styles.privacyNote, { backgroundColor: colors.secondary }]}>
              <Feather name="shield" size={15} color={colors.primary} />
              <Text style={[styles.privacyText, { color: colors.foreground }]}>
                Your answers stay on this device and are never sent to the API
                server or a cloud service.
              </Text>
            </View>

            <Text style={[styles.label, { color: colors.cardForeground }]}>
              Preferred name
            </Text>
            <TextInput
              testID="profile-name"
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={80}
              placeholder="What should I call you?"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              returnKeyType="next"
              style={[
                styles.input,
                { backgroundColor: colors.background, borderColor: colors.border, color: colors.cardForeground },
              ]}
            />

            <Text style={[styles.label, { color: colors.cardForeground }]}>
              Personal context
            </Text>
            <TextInput
              testID="profile-context"
              value={context}
              onChangeText={setContext}
              maxLength={2000}
              placeholder="Goals, work, routines, or how you like responses…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
              style={[
                styles.input,
                styles.contextInput,
                { backgroundColor: colors.background, borderColor: colors.border, color: colors.cardForeground },
              ]}
            />
            <Text style={[styles.counter, { color: colors.mutedForeground }]}>
              {context.length}/2000
            </Text>

            <View style={styles.actions}>
              {isOnboarding ? (
                <Pressable
                  testID="skip-profile"
                  accessibilityRole="button"
                  onPress={handleSkip}
                  disabled={isSaving}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: colors.border },
                    isSaving && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.cardForeground }]}>
                    Skip for now
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.settingsActions}>
                  {hasProfile && (
                    <Pressable
                      testID="clear-profile"
                      accessibilityRole="button"
                      onPress={handleClear}
                      disabled={isSaving}
                      style={({ pressed }) => [
                        styles.clearButton,
                        { borderColor: colors.destructive },
                        isSaving && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Feather name="trash-2" size={14} color={colors.destructive} />
                      <Text style={[styles.clearButtonText, { color: colors.destructive }]}>
                        Clear
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    testID="cancel-profile"
                    accessibilityRole="button"
                    onPress={onClose}
                    disabled={isSaving}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      { borderColor: colors.border },
                      isSaving && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.cardForeground }]}>
                      Cancel
                    </Text>
                  </Pressable>
                </View>
              )}
              <Pressable
                testID="save-profile"
                accessibilityRole="button"
                onPress={handleSave}
                disabled={isSaving}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  isSaving && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                  {isSaving ? 'Saving…' : isOnboarding ? 'Continue' : 'Save changes'}
                </Text>
                {!isSaving && <Feather name="arrow-right" size={15} color={colors.primaryForeground} />}
              </Pressable>
            </View>
          </View>
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
  },
  headingRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 9,
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 8,
  },
  title: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.7,
    marginBottom: 8,
  },
  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 15,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginBottom: 18,
  },
  privacyText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  label: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 12,
    marginBottom: 7,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginBottom: 15,
  },
  contextInput: {
    minHeight: 118,
    lineHeight: 20,
  },
  counter: {
    alignSelf: 'flex-end',
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginTop: -10,
    marginBottom: 14,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 4,
  },
  settingsActions: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 13,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  primaryButtonText: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 12,
  },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  clearButton: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  clearButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
});