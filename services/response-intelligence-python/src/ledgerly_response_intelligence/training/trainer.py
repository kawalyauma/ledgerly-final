from __future__ import annotations

import inspect
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .models import FineTuneConfig


class TrainingDependencyError(RuntimeError):
    pass


@dataclass
class TrainingOutcome:
    output_dir:str
    base_model:str
    mode:str
    examples:int
    metrics:dict[str,Any]


def _supported_kwargs(target:Callable[...,Any],values:dict[str,Any])->dict[str,Any]:
    """Filter optional kwargs against the installed TRL/Transformers signature."""
    try:
        parameters=inspect.signature(target).parameters
    except (TypeError,ValueError):
        return values
    if any(item.kind is inspect.Parameter.VAR_KEYWORD for item in parameters.values()):
        return values
    return {key:value for key,value in values.items() if key in parameters}


def _training_config(config_type:Callable[...,Any],values:dict[str,Any])->Any:
    return config_type(**_supported_kwargs(config_type,values))


def train_adapter(config:FineTuneConfig)->TrainingOutcome:
    """Train an SFT/DPO LoRA or QLoRA adapter.

    Heavy ML dependencies are imported lazily. QLoRA loads the base model in 4-bit
    before PEFT training; quantization configuration is never incorrectly passed to
    the trainer itself.
    """
    try:
        import torch
        from datasets import load_dataset
        from peft import LoraConfig,prepare_model_for_kbit_training
        from transformers import AutoModelForCausalLM,AutoTokenizer,BitsAndBytesConfig
        from trl import DPOConfig,DPOTrainer,SFTConfig,SFTTrainer
    except ImportError as exc:
        raise TrainingDependencyError(
            'Install training extras first: pip install -e ".[training]" '
            'or QLoRA extras: pip install -e ".[training,qlora]"'
        ) from exc

    dataset_path=Path(config.dataset_path)
    if not dataset_path.exists():
        raise FileNotFoundError(dataset_path)
    output=Path(config.output_dir)
    output.mkdir(parents=True,exist_ok=True)
    dataset=load_dataset("json",data_files=str(dataset_path),split="train")
    if len(dataset)<2:
        raise ValueError(f"At least two approved {config.objective.upper()} examples are required for adapter training.")

    tokenizer=AutoTokenizer.from_pretrained(config.base_model)
    if tokenizer.pad_token_id is None:
        if tokenizer.eos_token_id is None:
            tokenizer.add_special_tokens({"pad_token":"<|pad|>"})
        else:
            tokenizer.pad_token=tokenizer.eos_token

    compute_dtype=torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else (
        torch.float16 if torch.cuda.is_available() else torch.float32
    )
    model_kwargs:dict[str,Any]={"low_cpu_mem_usage":True}
    if torch.cuda.is_available():
        model_kwargs["device_map"]="auto"
        model_kwargs["torch_dtype"]=compute_dtype

    if config.mode=="qlora":
        if not torch.cuda.is_available():
            raise RuntimeError("QLoRA requires a CUDA-capable GPU with bitsandbytes support.")
        model_kwargs["quantization_config"]=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=compute_dtype,
        )

    model=AutoModelForCausalLM.from_pretrained(config.base_model,**model_kwargs)
    if getattr(model,"resize_token_embeddings",None) and len(tokenizer)>int(model.get_input_embeddings().weight.shape[0]):
        model.resize_token_embeddings(len(tokenizer))
    model.config.use_cache=False
    if config.mode=="qlora":
        model=prepare_model_for_kbit_training(model,use_gradient_checkpointing=True)

    lora=LoraConfig(
        r=config.lora_r,
        lora_alpha=config.lora_alpha,
        lora_dropout=config.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=config.target_modules,
    )

    common_args:dict[str,Any]={
        "output_dir":str(output),
        "num_train_epochs":config.epochs,
        "learning_rate":config.learning_rate,
        "per_device_train_batch_size":config.batch_size,
        "gradient_accumulation_steps":config.gradient_accumulation_steps,
        "logging_steps":5,
        "save_strategy":"epoch",
        "report_to":"none",
        "seed":config.seed,
        "gradient_checkpointing":True,
        "bf16":bool(torch.cuda.is_available() and torch.cuda.is_bf16_supported()),
        "fp16":bool(torch.cuda.is_available() and not torch.cuda.is_bf16_supported()),
    }

    if config.objective=="dpo":
        dpo_args={
            **common_args,
            "max_length":config.max_length,
            "max_prompt_length":max(128,min(config.max_length//2,4096)),
            "beta":config.dpo_beta,
        }
        args=_training_config(DPOConfig,dpo_args)
        trainer_values:dict[str,Any]={
            "model":model,
            "args":args,
            "train_dataset":dataset,
            "peft_config":lora,
            "processing_class":tokenizer,
            "tokenizer":tokenizer,
        }
        trainer=DPOTrainer(**_supported_kwargs(DPOTrainer,trainer_values))
    else:
        sft_args={
            **common_args,
            "max_length":config.max_length,
            "max_seq_length":config.max_length,
        }
        args=_training_config(SFTConfig,sft_args)
        trainer_values={
            "model":model,
            "args":args,
            "train_dataset":dataset,
            "peft_config":lora,
            "processing_class":tokenizer,
            "tokenizer":tokenizer,
        }
        trainer=SFTTrainer(**_supported_kwargs(SFTTrainer,trainer_values))

    result=trainer.train()
    trainer.save_model(str(output))
    if hasattr(tokenizer,"save_pretrained"):
        tokenizer.save_pretrained(str(output))
    metrics={str(key):value for key,value in dict(result.metrics).items()}
    (output/"ledgerly-training.json").write_text(json.dumps({
        "base_model":config.base_model,
        "objective":config.objective,
        "mode":config.mode,
        "examples":len(dataset),
        "metrics":metrics,
        "config":config.model_dump(mode="json"),
    },ensure_ascii=False,indent=2,default=str),encoding="utf-8")
    return TrainingOutcome(
        output_dir=str(output),
        base_model=config.base_model,
        mode=config.mode,
        examples=len(dataset),
        metrics=metrics,
    )
