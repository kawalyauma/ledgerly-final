from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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


def train_adapter(config:FineTuneConfig)->TrainingOutcome:
    """Train a LoRA/QLoRA adapter using optional Hugging Face dependencies.

    Heavy ML dependencies are deliberately imported lazily so production response
    workers do not need PyTorch, Transformers or a GPU.
    """
    try:
        from datasets import load_dataset
        from peft import LoraConfig
        import torch
        from transformers import BitsAndBytesConfig
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
        raise ValueError("At least two approved SFT examples are required for adapter training.")

    lora=LoraConfig(
        r=config.lora_r,lora_alpha=config.lora_alpha,lora_dropout=config.lora_dropout,
        bias="none",task_type="CAUSAL_LM",target_modules=config.target_modules,
    )
    quantization=None
    if config.mode=="qlora":
        quantization=BitsAndBytesConfig(
            load_in_4bit=True,bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,bnb_4bit_compute_dtype=torch.bfloat16,
        )

    if config.objective=="dpo":
        args=DPOConfig(
            output_dir=str(output),num_train_epochs=config.epochs,learning_rate=config.learning_rate,
            per_device_train_batch_size=config.batch_size,
            gradient_accumulation_steps=config.gradient_accumulation_steps,
            max_length=config.max_length,beta=config.dpo_beta,logging_steps=5,save_strategy="epoch",
            report_to="none",seed=config.seed,gradient_checkpointing=True,
        )
        trainer=DPOTrainer(
            model=config.base_model,args=args,train_dataset=dataset,peft_config=lora,
            quantization_config=quantization,
        )
    else:
        args=SFTConfig(
            output_dir=str(output),num_train_epochs=config.epochs,learning_rate=config.learning_rate,
            per_device_train_batch_size=config.batch_size,
            gradient_accumulation_steps=config.gradient_accumulation_steps,
            max_length=config.max_length,logging_steps=5,save_strategy="epoch",
            report_to="none",seed=config.seed,gradient_checkpointing=True,
        )
        trainer=SFTTrainer(
            model=config.base_model,args=args,train_dataset=dataset,peft_config=lora,
            quantization_config=quantization,
        )
    result=trainer.train()
    trainer.save_model(str(output))
    metrics={str(key):value for key,value in dict(result.metrics).items()}
    (output/"ledgerly-training.json").write_text(json.dumps({
        "base_model":config.base_model,"objective":config.objective,"mode":config.mode,"examples":len(dataset),
        "metrics":metrics,"config":config.model_dump(mode="json"),
    },ensure_ascii=False,indent=2),encoding="utf-8")
    return TrainingOutcome(
        output_dir=str(output),base_model=config.base_model,mode=config.mode,
        examples=len(dataset),metrics=metrics,
    )
