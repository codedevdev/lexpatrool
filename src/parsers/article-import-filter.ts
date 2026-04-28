import type { SplitArticle } from './article-split'

/** Фильтр блоков после разбиения: все | только с санкциями | только без (справочные тексты). */
export type ArticleImportFilter = 'all' | 'with_sanctions' | 'without_sanctions'

export function filterArticleSplits(splits: SplitArticle[], filter: ArticleImportFilter): SplitArticle[] {
  if (filter === 'all') return splits
  return splits.filter((s) => {
    const has = hasSanctionSignals(s.heading, s.body)
    return filter === 'with_sanctions' ? has : !has
  })
}

/** Проверка произвольного фрагмента (весь импорт или один блок). */
export function textHasSanctionSignals(text: string): boolean {
  return hasSanctionSignals('', text)
}

function hasSanctionSignals(heading: string, body: string): boolean {
  const t = `${heading}\n${body}`

  // Явная рубрика наказания / санкции (ASCII и типографское двоеточие)
  if (/(?:Наказание|Санкци)\s*[:：]/i.test(t)) return true
  if (/наказание\s+в\s+виде/i.test(t)) return true
  if (/административн\w*\s+штраф/i.test(t)) return true

  // Денежные санкции: $, руб., ₽
  if (/\$\s*[\d]|[\d][\d\s.,]*\s*\$/i.test(t)) return true
  if (/\d[\d\s.,]*\s*(?:руб\.?|₽)/i.test(t) && /(?:штраф|санкци|наказан|взыскан|не\s+менее|до\s+\d)/i.test(t)) return true

  // Лишение свободы, арест, обязательные работы (типичный АК)
  if (/лишени[ея]\s+свободы|лишение\s+свободы|административн\w*\s+арест/i.test(t)) return true
  if (/до\s*\d+\s*(?:суток|часов|месяц|минут)/i.test(t) && /(?:арест|задержан|лишен)/i.test(t)) return true
  if (/обязательн\w*\s+работ/i.test(t)) return true

  // «Штраф» в санкционном контексте (не одно слово без цифр/формулировок)
  if (/штраф/i.test(t)) {
    if (
      /(?:Наказание|штраф\s+(?:до|в\s+размере|не\s+менее)|\$|руб\.?|₽|млн|тыс\.)/i.test(t)
    ) {
      return true
    }
  }

  // Предупреждение как мера (часто в АК рядом с штрафом)
  if (/предупреждени\w*\s*[:：]/i.test(t) && /(?:Наказание|мер[аы]\s+наказан|административн)/i.test(t)) {
    return true
  }

  return false
}
