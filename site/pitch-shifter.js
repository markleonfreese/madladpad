import {GranularPitchShifter} from './pitch-dsp.js';

class MadLadPadPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [{name:'semitones',defaultValue:0,minValue:-24,maxValue:24,automationRate:'k-rate'}];}
  constructor(){super();this.shifter=new GranularPitchShifter(sampleRate,2);}
  process(inputs,outputs,parameters){return this.shifter.process(inputs[0],outputs[0],parameters.semitones?.[0]||0);}
}

registerProcessor('madladpad-pitch-shifter',MadLadPadPitchProcessor);
