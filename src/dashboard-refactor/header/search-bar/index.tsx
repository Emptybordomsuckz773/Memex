import React, { PureComponent } from 'react'
import styled from 'styled-components'

import Margin from 'src/dashboard-refactor/components/Margin'

import colors from '../../colors'
import styles, { fonts } from '../../styles'

const textStyles = `
    font-family: ${fonts.primary.name};
    font-style: normal;
    font-weight: ${fonts.primary.weight.bold};
    color: ${fonts.primary.colors.primary};
`

const SearchBarContainer = styled.div`
    height: 34px;
    width: ${styles.components.searchBar.widthPx}px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: ${colors.lightGrey};
    border-radius: 5px;
`

const Input = styled.input`
    width: inherit;
    font-size: 12px;
    line-height: 18px;
    border: none;
    background-color: transparent;

    &:focus {
        outline: none;
    }

    &::placeholder {
        ${textStyles}
    }
`

const FilterButton = styled.div`
    width: max-content;
    ${textStyles}
    font-size: 12px;
    line-height: 15px;
    cursor: pointer;
`

const FullWidthMargin = styled(Margin)`
    width: 100%;
`

export interface SearchBarProps {
    placeholder?: string
    searchQuery: string
    isSearchBarFocused: boolean
    searchFiltersOpen: boolean
    onSearchBarFocus(): void
    onSearchQueryChange(queryString: string): void
    onSearchFiltersOpen(): void
}

export default class SearchBar extends PureComponent<SearchBarProps> {
    inputRef = React.createRef<HTMLInputElement>()
    componentDidMount = () => {
        if (this.props.isSearchBarFocused) {
            this.inputRef.current.focus()
        }
    }
    handleChange: React.KeyboardEventHandler = (evt) => {
        // need to amend getFilterStrings function to pull through search terms as well, then
        // bundle them in an object to send with the onSearchQueryChange func
        this.props.onSearchQueryChange((evt.target as HTMLInputElement).value)
    }
    render() {
        const {
            searchFiltersOpen,
            searchQuery,
            onSearchFiltersOpen,
            onSearchBarFocus,
        } = this.props
        return (
            <Margin vertical="auto">
                <SearchBarContainer onClick={onSearchBarFocus}>
                    <FullWidthMargin left="15px">
                        <Input
                            ref={this.inputRef}
                            placeholder={
                                this.props.placeholder ??
                                'Search your saved pages and notes'
                            }
                            value={searchQuery}
                            onChange={this.handleChange}
                            autoComplete="off"
                        />
                    </FullWidthMargin>
                    <Margin horizontal="15px">
                        <FilterButton onClick={onSearchFiltersOpen}>
                            {searchFiltersOpen ? 'Remove Filters' : 'Filters'}
                        </FilterButton>
                    </Margin>
                </SearchBarContainer>
            </Margin>
        )
    }
}