from urllib.parse import urlsplit, urlunsplit

def sanitize_url(value: str) -> str:
    try:
        u=urlsplit(value)
        return urlunsplit((u.scheme,u.hostname or '',u.path,'',''))
    except (ValueError,TypeError):return 'invalid-url'

def safe_metadata(meta:dict)->dict:
    allowed={'tabId','documentId','frameId','durationMs','matchCount','adapterVersion','code','correlation','transitionType','phase','tool'}
    result={k:v for k,v in meta.items() if k in allowed and isinstance(v,(str,int,float,bool))}
    if 'url' in meta:result['url']=sanitize_url(meta['url'])
    return result
