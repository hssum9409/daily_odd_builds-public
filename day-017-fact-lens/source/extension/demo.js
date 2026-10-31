// Synthetic examples only; never used as a fallback when model requests fail.
export function exampleReport() {
 return {demo:true,model:'예시',checkedAt:null,article:{title:'달과 지구에 관한 세 가지 주장',url:'https://example.com/',capturedAt:null},claims:[
 {id:'example-1',quote:'달은 지구 주위를 공전한다.',claim:'달의 공전 대상은 지구다.',verdict:'supported',reason:'달의 공전 궤도 설명이 제시되는 예시입니다.',explanation:'**달의 공전 궤도**에 관한 설명이 이 주장을 뒷받침합니다. **실제 검색 결과가 아닌 예시**입니다.',sources:[{title:'달의 궤도 · 예시 자료',url:'https://example.com/',evidence:'출처와 근거가 표시되는 위치를 보여주는 가상 자료입니다.',relation:'supports'}]},
 {id:'example-2',quote:'달은 스스로 빛을 낸다.',claim:'달이 자체적으로 빛을 방출한다.',verdict:'refuted',reason:'태양빛의 반사가 반대 근거로 제시되는 예시입니다.',explanation:'태양빛의 반사에 관한 근거 설명이 표시되는 자리입니다. 실제 검색으로 얻은 결과가 아닙니다.',sources:[]},
 {id:'example-3',quote:'달의 뒷면에는 지하 도시가 있다.',claim:'달 뒷면에 지하 도시가 존재한다.',verdict:'insufficient',reason:'도시의 존재를 뒷받침할 독립적인 출처가 없는 예시입니다.',explanation:'독립적인 출처를 확보하지 못한 경우의 예시입니다.',sources:[]},
 ]};
}
