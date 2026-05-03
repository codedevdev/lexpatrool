import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RouteEmptyState } from './RouteEmptyState'

describe('RouteEmptyState', () => {
  it('рендерит заголовок и описание для variant empty', () => {
    render(
      <MemoryRouter>
        <RouteEmptyState title="Пусто" description="Нет данных" />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: 'Пусто' })).toBeInTheDocument()
    expect(screen.getByText('Нет данных')).toBeInTheDocument()
  })

  it('для loading не показывает кнопки навигации', () => {
    render(
      <MemoryRouter>
        <RouteEmptyState variant="loading" title="Загрузка…" />
      </MemoryRouter>
    )
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
    expect(screen.queryByText('← Назад')).not.toBeInTheDocument()
  })

  it('клик по «База знаний» ведёт на /kb', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RouteEmptyState title="X" />} />
          <Route path="/kb" element={<div data-testid="kb-page">kb</div>} />
        </Routes>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: /База знаний/i }))
    expect(screen.getByTestId('kb-page')).toBeInTheDocument()
  })
})
