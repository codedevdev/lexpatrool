import type { SplitArticle } from './article-split'
import { logParse, shouldLogParsePipeline } from './parse-trace'

/** Фильтр блоков после разбиения: все | только с санкциями | только без (справочные тексты). */
export type ArticleImportFilter = 'all' | 'with_sanctions' | 'without_sanctions'

export function filterArticleSplits(splits: SplitArticle[], filter: ArticleImportFilter): SplitArticle[] {
  if (filter === 'all') return splits
  const dropped: Array<{ articleNumber: string | null; headingPreview: string; reason: string }> = []
  const out: SplitArticle[] = []
  for (const s of splits) {
    const has = hasSanctionSignals(s.heading, s.body)
    const keep = filter === 'with_sanctions' ? has : !has
    if (keep) {
      out.push(s)
    } else {
      dropped.push({
        articleNumber: s.articleNumber,
        headingPreview: s.heading.slice(0, 96),
        reason:
          filter === 'with_sanctions'
            ? 'нет маркеров санкций (таблица UK/Наказание/$/меры/СР/лишение свободы/…) в heading+body'
            : 'есть маркеры санкций — режим without_sanctions отсекает такие блоки'
      })
    }
  }
  if (shouldLogParsePipeline() && dropped.length > 0) {
    logParse('filterArticleSplits: отсеянные блоки (articleFilter)', {
      filter,
      droppedCount: dropped.length,
      samples: dropped.slice(0, 45),
      truncated: dropped.length > 45,
      hint:
        filter === 'with_sanctions'
          ? 'Для проверки сплиттера поставьте «Все статьи» или articleFilter=all — часть блоков может не иметь санкций на своей строке.'
          : undefined
    })
  }
  return out
}

/** Проверка произвольного фрагмента (весь импорт или один блок). */
export function textHasSanctionSignals(text: string): boolean {
  return hasSanctionSignals('', text)
}

function hasSanctionSignals(heading: string, body: string): boolean {
  const t = `${heading}\n${body}`
  if (!t.trim()) return false

  // --- Majestic UK / XenForo (часто санкции на соседних строках, не в первом абзаце) ---
  // Классификация строки статьи: (F, CR), (A, CR), латиница + кириллическая буква в скобках
  if (/\([A-ZА-ЯЁ],\s*CR\)/i.test(t)) return true
  // Таблица: «… | 3*», «… | 75.000$»
  if (/\|[^\n]*(?:\$|[\d][\d\s.,]*\$|\d\s*\*)/i.test(t)) return true
  // Заголовок строки без «|», только звёзды тяжести в конце (как в последней колонке)
  if (/(?:^|\n)[^\n]*\d\s*\*\s*(?:\n|$)/i.test(t)) return true
  if (/Выход\s+под\s+залог|под\s+залог\s*:|залог\s*:\s*[\d]/i.test(t)) return true

  // --- Явные рубрики ---
  if (/(?:Наказание|Санкци|Мера\s+наказан|Вид\s+наказан|Виды\s+наказан|Меры\s+наказан)\s*[:：]/i.test(t)) {
    return true
  }
  if (/наказание\s+в\s+виде/i.test(t)) return true
  if (/административн\w*\s+штраф/i.test(t)) return true

  // --- Деньги ($ в конце суммы типа 75.000$ уже покрыто вторым паттерном) ---
  if (/\$\s*[\d]|[\d][\d\s.,]*\s*\$/i.test(t)) return true
  if (
    /\d[\d\s.,]*\s*(?:руб\.?|₽)/i.test(t) &&
    /(?:штраф|санкци|наказан|взыскан|не\s+менее|до\s+\d|залог)/i.test(t)
  ) {
    return true
  }

  // --- Лишение свободы, ограничения, арест (УК / АК) ---
  if (
    /лишени[ея]\s+свободы|лишение\s+свободы|административн\w*\s+арест|ограничени[ея]\s+свобод/i.test(t)
  ) {
    return true
  }
  if (/лишени[ея]\s+специальн|лишени[ея]\s+права\s+занимат/i.test(t)) return true
  if (/пожизненн|пожизненное\s+заключен/i.test(t)) return true
  if (/до\s*\d+\s*(?:суток|часов|месяц|минут|лет|год|мес\.)/i.test(t) && /(?:арест|задержан|лишен|лишению|свобод)/i.test(t)) {
    return true
  }
  if (/до\s*\d+\s*(?:месяц|лет|год|мес\.)/i.test(t) && /(?:лишен|наказан|заключен|колон|тюрем)/i.test(t)) {
    return true
  }

  // --- Принудительные / исправительные / общественные работы ---
  if (
    /обязательн\w*\s+работ|исправительн\w*\s+работ|принудительн\w*\s+работ|общественн\w*\s+работ/i.test(
      t
    )
  ) {
    return true
  }

  // --- Конфискация, условное (часто рядом с мерами в тексте УК) ---
  if (/конфискаци/i.test(t) && /(?:имуществ|оружи|предмет|Наказание|мер)/i.test(t)) return true
  if (/условн\w*\s+осужден/i.test(t)) return true
  if (/условн\w*\s+срок/i.test(t)) return true

  // --- «Штраф» в санкционном контексте ---
  if (/штраф/i.test(t)) {
    if (
      /(?:Наказание|штраф\s+(?:до|в\s+размере|не\s+менее|от)|\$|руб\.?|₽|млн|тыс\.)/i.test(t)
    ) {
      return true
    }
  }

  // --- Предупреждение как мера ---
  if (/предупреждени\w*\s*[:：]/i.test(t) && /(?:Наказание|мер[аы]\s+наказан|административн)/i.test(t)) {
    return true
  }

  // --- Англ. врезки на форуме ---
  if (/\b(?:fine|jail|bail|sentence)\b/i.test(t) && /\d/.test(t)) return true

  return false
}
