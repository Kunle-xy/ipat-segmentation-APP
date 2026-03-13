/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import Header from '../components/Header'

// Mock Next.js Link component
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>
  }
})

describe('Header Component', () => {
  it('renders without crashing', () => {
    render(<Header />)
    expect(screen.getByText(/PROSPER/i)).toBeInTheDocument()
  })

  it('displays the IPAT title', () => {
    render(<Header />)
    expect(screen.getByText(/Iowa Pavement Analysis Tool/i)).toBeInTheDocument()
  })

  it('displays the version number', () => {
    render(<Header />)
    expect(screen.getByText(/Version 1.1.0/i)).toBeInTheDocument()
  })

  it('contains link to PROSPER website', () => {
    render(<Header />)
    const link = screen.getByRole('link', { name: /PROSPER/i })
    expect(link).toHaveAttribute('href', 'https://prosper.intrans.iastate.edu/')
  })

  it('link opens in new tab', () => {
    render(<Header />)
    const link = screen.getByRole('link', { name: /PROSPER/i })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('displays PROSPER description', () => {
    render(<Header />)
    expect(screen.getByText(/Program for Sustainable Pavement Engineering and Research/i)).toBeInTheDocument()
  })
})
