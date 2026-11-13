<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
const props = defineProps<{ enabled: boolean }>();
const emit = defineEmits<{ change: [value: number] }>();
const value = ref(0);
let pointer: number | undefined;
function reset() {
  pointer = undefined;
  value.value = 0;
  emit("change", 0);
}
function move(event: PointerEvent) {
  if (pointer !== event.pointerId || !props.enabled) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const raw = Math.max(
    -1,
    Math.min(1, (event.clientX - rect.x - rect.width / 2) / (rect.width * 0.38)),
  );
  value.value = Math.abs(raw) < 0.08 ? 0 : (Math.sign(raw) * (Math.abs(raw) - 0.08)) / 0.92;
  emit("change", value.value);
}
function down(event: PointerEvent) {
  if (!props.enabled || pointer !== undefined) return;
  event.preventDefault();
  pointer = event.pointerId;
  (event.currentTarget as HTMLElement).setPointerCapture(pointer);
  move(event);
}
function end(event: PointerEvent) {
  if (pointer === event.pointerId) reset();
}
watch(() => props.enabled, reset);
onBeforeUnmount(reset);
</script>

<template>
  <div
    class="touch-steering"
    role="group"
    aria-label="滑动转向"
    :aria-disabled="!enabled"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="end"
    @pointercancel="end"
    @lostpointercapture="end"
  >
    <span>左　·　滑动转向　·　右</span>
    <i :style="{ transform: `translateX(${value * 48}px)` }"></i>
  </div>
</template>
