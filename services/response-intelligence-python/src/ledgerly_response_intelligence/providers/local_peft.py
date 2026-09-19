from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from typing import Any

from .base import ProviderResponse


class LocalPeftProvider:
    """Lazy local inference for a trained PEFT adapter.

    Heavy model libraries are imported only when this provider is actually used.
    Instances are cached by the provider factory so model weights are not reloaded for
    every response.
    """

    name="local-peft"

    def __init__(
        self,
        *,
        base_model:str,
        adapter_path:str,
        device_map:str="auto",
        temperature:float=0.55,
    )->None:
        self.base_model=base_model
        self.adapter_path=adapter_path
        self.device_map=device_map
        self.temperature=temperature
        self.model=f"{base_model}+{Path(adapter_path).name}"
        self._model:Any=None
        self._tokenizer:Any=None
        self._lock=threading.RLock()

    def _load(self)->tuple[Any,Any]:
        with self._lock:
            if self._model is not None and self._tokenizer is not None:
                return self._model,self._tokenizer
            try:
                from peft import AutoPeftModelForCausalLM
                from transformers import AutoTokenizer
            except ImportError as exc:
                raise RuntimeError(
                    'Local adapter inference requires ML extras: pip install -e ".[training]"'
                ) from exc
            adapter=Path(self.adapter_path)
            if not adapter.exists():
                raise FileNotFoundError(adapter)
            tokenizer=AutoTokenizer.from_pretrained(self.base_model)
            if tokenizer.pad_token_id is None and tokenizer.eos_token_id is not None:
                tokenizer.pad_token=tokenizer.eos_token
            model=AutoPeftModelForCausalLM.from_pretrained(
                str(adapter),device_map=self.device_map,low_cpu_mem_usage=True,
            )
            model.eval()
            self._model=model
            self._tokenizer=tokenizer
            return model,tokenizer

    def _generate_sync(self,system:str,prompt:str,max_tokens:int)->ProviderResponse:
        try:
            import torch
        except ImportError as exc:
            raise RuntimeError('Local adapter inference requires PyTorch.') from exc
        model,tokenizer=self._load()
        messages=[{"role":"system","content":system},{"role":"user","content":prompt}]
        if hasattr(tokenizer,"apply_chat_template"):
            rendered=tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True)
        else:
            rendered=system+"\n\n"+prompt+"\n\nAssistant:"
        encoded=tokenizer(rendered,return_tensors="pt")
        device=next(model.parameters()).device
        encoded={key:value.to(device) for key,value in encoded.items()}
        prompt_length=int(encoded["input_ids"].shape[-1])
        kwargs={
            "max_new_tokens":max_tokens,
            "pad_token_id":tokenizer.pad_token_id or tokenizer.eos_token_id,
            "eos_token_id":tokenizer.eos_token_id,
        }
        if self.temperature>0:
            kwargs.update({"do_sample":True,"temperature":self.temperature,"top_p":0.92})
        else:
            kwargs.update({"do_sample":False})
        with torch.inference_mode():
            generated=model.generate(**encoded,**kwargs)
        new_tokens=generated[0][prompt_length:]
        text=tokenizer.decode(new_tokens,skip_special_tokens=True).strip()
        return ProviderResponse(text=text,provider=self.name,model=self.model)

    async def generate(self,*,system:str,prompt:str,max_tokens:int=3000)->ProviderResponse:
        return await asyncio.to_thread(self._generate_sync,system,prompt,max_tokens)
