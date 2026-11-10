import Sortable from 'sortablejs'
import { watch, type Ref } from 'vue'

/**
 * Przeciąganie (działa też dotykiem) bez oddawania DOM-u bibliotece: po upuszczeniu
 * cofamy zmianę w DOM, a kolejność zmienia się w danych – Vue renderuje resztę.
 * Elementy listy muszą mieć atrybut data-id; listy – data-list.
 * Podpina się, gdy element pojawi się w DOM (także po v-if / zmianie :key).
 */
export function useSortable(
  el: Ref<HTMLElement | null>,
  opts: { group?: string; handle?: string; onMove: (id: string, fromList: string, toList: string, newIndex: number) => void },
) {
  let nextSibling: Node | null = null
  watch(
    el,
    (node, _old, onCleanup) => {
      if (!node) return
      const s = Sortable.create(node, {
        group: opts.group,
        handle: opts.handle,
        animation: 150,
        ghostClass: 'opacity-40',
        onStart(evt) {
          nextSibling = evt.item.nextSibling
        },
        onEnd(evt) {
          const { item, from, to, oldIndex, newIndex } = evt
          if (oldIndex == null || newIndex == null) return
          if (from === to && oldIndex === newIndex) return
          // Przywróć DOM do stanu sprzed przeciągnięcia (przed zapamiętany węzeł – v-for ma własne kotwice).
          item.parentNode?.removeChild(item)
          from.insertBefore(item, nextSibling)
          opts.onMove(item.dataset.id!, from.dataset.list ?? '', to.dataset.list ?? '', newIndex)
        },
      })
      onCleanup(() => s.destroy())
    },
    { flush: 'post' },
  )
}
