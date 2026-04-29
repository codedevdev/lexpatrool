import type { SplitArticle } from './article-split'
import { logParse, shouldLogParsePipeline } from './parse-trace'

/** Фильтр блоков после разбиения: все | только с санкциями | только без (справочные тексты). */
export type ArticleImportFilter = 'all' | 'with_sanctions' | 'without_sanctions'

/**
 * Режим определения «есть ли санкция»:
 * - `soft` (умолчание для общего детектора, например `textHasSanctionSignals`) — широкие эвристики:
 *   «лишение свободы», «наказание в виде» и пр. сами по себе считаются санкцией.
 * - `balanced` (для импорта `with_sanctions`) — нужен хотя бы один сильный маркер:
 *   классификатор `(R|F|A[, CR])`, табличная вставка `| N*` / `| $N`, прямая рубрика `Наказание:`,
 *   сумма `$N` / `N руб` рядом со словом наказан/штраф/санкци, или конкретный срок
 *   `N мес/лет/суток/часов` рядом с тем же санкционным словом.
 *   Голое «лишение свободы» в перечислении видов наказаний под определение не попадает.
 * - `strict` (для импорта `without_sanctions`) — самые строгие требования: только явные
 *   таблицы, классификатор, `Наказание:`, суммы и сроки рядом с конкретными приговорами.
 */
export type SanctionDetectMode = 'soft' | 'balanced' | 'strict'

export interface SanctionDetectOptions {
  /** @deprecated Используйте `mode`. Сохранено для обратной совместимости (`true` ≡ `'strict'`). */
  strict?: boolean
  mode?: SanctionDetectMode
}

export function filterArticleSplits(
  splits: SplitArticle[],
  filter: ArticleImportFilter
): SplitArticle[] {
  if (filter === 'all') return splits
  const dropped: Array<{ articleNumber: string | null; headingPreview: string; reason: string }> = []
  const out: SplitArticle[] = []
  const mode: SanctionDetectMode =
    filter === 'without_sanctions' ? 'strict' : filter === 'with_sanctions' ? 'balanced' : 'soft'
  for (const s of splits) {
    const has = hasSanctionSignals(s.heading, s.body, { mode })
    const keep = filter === 'with_sanctions' ? has : !has
    if (keep) {
      out.push(s)
    } else {
      dropped.push({
        articleNumber: s.articleNumber,
        headingPreview: s.heading.slice(0, 96),
        reason:
          filter === 'with_sanctions'
            ? 'нет сильных маркеров санкций (классификатор (R/F/A,CR) / | N* / Наказание: / $N / срок+слово наказан) в heading+body'
            : 'есть явные маркеры санкций (Наказание:/$/руб/(R/F/A,CR)/таблица/конкретные сроки) — режим without_sanctions отсекает такие блоки'
      })
    }
  }
  if (shouldLogParsePipeline() && dropped.length > 0) {
    logParse('filterArticleSplits: отсеянные блоки (articleFilter)', {
      filter,
      mode,
      droppedCount: dropped.length,
      samples: dropped.slice(0, 45),
      truncated: dropped.length > 45,
      hint:
        filter === 'with_sanctions'
          ? 'Balanced-режим: остаются только блоки с явным маркером (классификатор / таблица / Наказание: / $N / срок рядом с санкционным словом). Если статья ушла мимо — проверьте, есть ли в её теле один из маркеров.'
          : 'Strict-режим (without_sanctions): режутся только блоки с явной таблицей санкций / суммами / классификатором (R/F/A,CR) / «Наказание:».'
    })
  }
  return out
}

/** Проверка произвольного фрагмента (весь импорт или один блок). */
export function textHasSanctionSignals(text: string, opts?: SanctionDetectOptions): boolean {
  return hasSanctionSignals('', text, opts)
}

function resolveMode(opts: SanctionDetectOptions | undefined): SanctionDetectMode {
  if (opts?.mode) return opts.mode
  if (opts?.strict === true) return 'strict'
  return 'soft'
}

function hasSanctionSignals(heading: string, body: string, opts?: SanctionDetectOptions): boolean {
  const t = `${heading}\n${body}`
  if (!t.trim()) return false
  const mode = resolveMode(opts)
  const strict = mode === 'strict'
  const balancedOrStrict = mode !== 'soft'

  // === Сильные маркеры — всегда санкция при любом режиме ===

  // Классификатор УК/АК форума: `(F, CR)`, `(A, CR)`, `(R)` (с CR или без).
  // Кириллические эквиваленты Р/Ф/А — тот же смысл (изредка встречаются в копипастах).
  if (/\(\s*(?:[RFAРФА])(?:\s*,\s*CR)?\s*\)/i.test(t)) return true
  // Табличная вставка: `… | 3*`, `… | 75.000$`
  if (/\|[^\n]*(?:\$|[\d][\d\s.,]*\$|\d\s*\*)/i.test(t)) return true
  // Только звёзды тяжести в конце строки (последняя колонка таблицы без |)
  if (/(?:^|\n)[^\n]*\d\s*\*\s*(?:\n|$)/i.test(t)) return true
  if (/Выход\s+под\s+залог|под\s+залог\s*:|залог\s*:\s*[\d]/i.test(t)) return true

  // Явные рубрики «Наказание: …», «Санкции: …», «Мера наказания: …»
  if (/(?:Наказание|Санкци|Мера\s+наказан|Вид\s+наказан|Виды\s+наказан|Меры\s+наказан)\s*[:：]/i.test(t)) {
    return true
  }
  if (/административн\w*\s+штраф/i.test(t)) return true

  // Денежная сумма с $ — всегда санкция
  if (/\$\s*[\d]|[\d][\d\s.,]*\s*\$/i.test(t)) return true
  // Денежная сумма в рублях рядом с санкционным словом
  if (
    /\d[\d\s.,]*\s*(?:руб\.?|₽)/i.test(t) &&
    /(?:штраф|санкци|наказан|взыскан|не\s+менее|до\s+\d|залог)/i.test(t)
  ) {
    return true
  }

  // === Дальше — паттерны, которые в balanced/strict ослабляются ===

  // Узкий набор «настоящих санкционных слов» — только намеренное наказание / приговор / штраф.
  // НЕ включаем «лишен/арест/тюрем/колон» — они часто встречаются в процессуальных статьях
  // («сроки лишения свободы суммируются», «после ареста подозреваемого»).
  const sanctionWordRe = /(?:наказан|штраф|санкци|осужд|пригов|приговор)/i
  const concreteDurationRe = /\d+\s*(?:суток|часов|лет|год\w*|месяц\w*|мес\.)/i

  // «…назначено наказание в виде лишения…» — в УК это санкция, в процессуалке — нарратив.
  if (
    /наказание\s+в\s+виде/i.test(t) &&
    !/назначен\w*\s+наказание\s+в\s+виде\s+лишени/i.test(t) &&
    !/наказание\s+в\s+виде\s+лишени[яи]\s+свободы\s+или\s+штрафн/i.test(t)
  ) {
    if (!balancedOrStrict) return true
    // balanced/strict: считаем санкцией только если рядом конкретная сумма/срок
    if (concreteDurationRe.test(t)) return true
  }

  // Лишение свободы / арест / ограничение свободы.
  // В balanced и strict требуется конкретный срок И настоящее санкционное слово (наказан/штраф/санкци/осужд/пригов),
  // а не общее «лишен/арест» — иначе определения вроде 1.3.4 «суммарный срок лишения свободы не может превышать 50 месяцев»
  // прорываются в `with_sanctions`.
  if (
    /лишени[ея]\s+свободы|лишение\s+свободы|административн\w*\s+арест|ограничени[ея]\s+свобод/i.test(t)
  ) {
    // Справочный перечень: «…лишения свободы или штрафная санкция…» — никогда не считаем санкцией.
    if (!/лишени[яи]\s+свободы\s+или\s+штрафн/i.test(t)) {
      if (!balancedOrStrict) return true
      if (concreteDurationRe.test(t) && sanctionWordRe.test(t)) return true
    }
  }
  if (/лишени[ея]\s+специальн|лишени[ея]\s+права\s+занимат/i.test(t)) {
    if (!balancedOrStrict) return true
    if (/\d+\s*(?:лет|год\w*|месяц\w*|мес\.)/i.test(t) && sanctionWordRe.test(t)) return true
  }
  if (/пожизненн|пожизненное\s+заключен/i.test(t)) {
    if (!balancedOrStrict) return true
    if (sanctionWordRe.test(t)) return true
  }
  if (
    /до\s*\d+\s*(?:суток|часов|месяц|минут|лет|год|мес\.)/i.test(t) &&
    /(?:арест|задержан|лишен|лишению|свобод)/i.test(t)
  ) {
    if (!balancedOrStrict) return true
    // balanced/strict: «до N суток ареста» — санкция только при явной сан-словарной рамке.
    if (sanctionWordRe.test(t)) return true
  }
  if (
    /до\s*\d+\s*(?:месяц|лет|год|мес\.)/i.test(t) &&
    /(?:лишен|наказан|заключен|колон|тюрем)/i.test(t)
  ) {
    if (!balancedOrStrict) return true
    if (sanctionWordRe.test(t)) return true
  }

  // Принудительные / исправительные / общественные работы
  if (
    /обязательн\w*\s+работ|исправительн\w*\s+работ|принудительн\w*\s+работ|общественн\w*\s+работ/i.test(
      t
    )
  ) {
    if (!balancedOrStrict) return true
    if (sanctionWordRe.test(t) && concreteDurationRe.test(t)) return true
  }

  // Конфискация / условное осуждение
  if (/конфискаци/i.test(t) && /(?:имуществ|оружи|предмет|Наказание|мер)/i.test(t)) {
    if (!balancedOrStrict) return true
    if (/(?:Наказание|санкци)/i.test(t)) return true
  }
  if (/условн\w*\s+осужден/i.test(t)) {
    if (!balancedOrStrict) return true
    if (sanctionWordRe.test(t)) return true
  }
  if (/условн\w*\s+срок/i.test(t)) {
    if (!balancedOrStrict) return true
    if (sanctionWordRe.test(t)) return true
  }

  // «Штраф» в санкционном контексте: с суммой, с предлогом или с рубрикой
  if (/штраф/i.test(t)) {
    if (
      /(?:Наказание|штраф\s+(?:до|в\s+размере|не\s+менее|от)|\$|руб\.?|₽|млн|тыс\.)/i.test(t)
    ) {
      return true
    }
  }

  // «Предупреждение:» как административная мера
  if (/предупреждени\w*\s*[:：]/i.test(t) && /(?:Наказание|мер[аы]\s+наказан|административн)/i.test(t)) {
    return true
  }

  // Англ. врезки на форуме (fine/jail/bail/sentence + цифра)
  if (/\b(?:fine|jail|bail|sentence)\b/i.test(t) && /\d/.test(t)) return true

  // strict: дополнительная страховка — нет ни одного из перечисленных индикаторов
  if (strict) return false
  return false
}
