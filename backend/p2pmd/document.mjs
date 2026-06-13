const MAX_DOCUMENT_LENGTH = 1024 * 1024

let documentState = {
  content: '',
  updatedAt: Date.now()
}

export function getDocumentState () {
  return {
    ...documentState
  }
}

export function updateDocumentState (content) {
  if (typeof content !== 'string') {
    return {
      ok: false,
      error: 'Invalid document content. Expected a string.'
    }
  }

  if (content.length > MAX_DOCUMENT_LENGTH) {
    return {
      ok: false,
      error: 'Document is too large. Maximum size is 1 MB.'
    }
  }

  documentState = {
    content,
    updatedAt: Date.now()
  }

  return {
    ok: true,
    document: getDocumentState()
  }
}

export function getMaxDocumentLength () {
  return MAX_DOCUMENT_LENGTH
}
