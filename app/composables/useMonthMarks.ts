import { computed, reactive, ref, watch, type Ref } from 'vue';
import { fetchPlaylistMonth, type PlaylistMonthDay } from '@/lib/api';

/**
 * 月历标记的加载与缓存。
 * 同一个月份只请求一次；失败不写入缓存，切回来还能重试。
 * 标记只是辅助信息，拿不到时日历照样能选日期，所以这里不往外抛错误。
 */
export function useMonthMarks(month: Ref<string>) {
  const cache = reactive<Record<string, PlaylistMonthDay[] | undefined>>({});
  const pending = ref(new Set<string>());
  const marks = computed(() => cache[month.value] ?? []);
  const loading = computed(() => pending.value.has(month.value));

  async function load(target: string = month.value): Promise<void> {
    if (cache[target] || pending.value.has(target)) return;
    pending.value.add(target);
    try {
      cache[target] = (await fetchPlaylistMonth(target)).days;
    } catch {
      // 静默失败：没有标记也能用日历
    } finally {
      pending.value.delete(target);
    }
  }

  watch(month, (value) => void load(value));
  return { marks, loading, load };
}
